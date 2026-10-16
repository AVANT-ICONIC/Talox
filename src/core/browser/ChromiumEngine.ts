import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { BrowserManager } from "../BrowserManager.js";
import { sampleBrowserProcesses } from "./ResourceMonitor.js";
import { type BrowserCapability, type BrowserEngineAdapter, BrowserEngineError, type BrowserTask } from "./types.js";

export interface ChromiumEngineOptions {
	/** Parent directory for an owned, ephemeral browser profile. */
	profileRoot?: string;
	/** Authenticated tasks explicitly borrow cookies through a new page, never the active page. */
	getAuthenticatedContext?: (task: BrowserTask) => BrowserContext | null;
	preparePage?: (page: Page) => Promise<void>;
	validateTask?: (task: BrowserTask) => void;
	onTiming?: (timing: {
		phase: "startup" | "navigation" | "execution";
		durationMs: number;
		signal: AbortSignal;
	}) => void;
}

interface Worker {
	page?: Page;
	context?: BrowserContext;
	borrowed: boolean;
	settled: Promise<void>;
	finish: () => void;
}

/** Chromium tasks reuse the existing BrowserManager and isolate each task's context. */
export class ChromiumEngine implements BrowserEngineAdapter {
	readonly name = "chromium" as const;
	readonly capabilities: ReadonlySet<BrowserCapability>;
	private static readonly BASE_CAPABILITIES: BrowserCapability[] = [
		"navigation",
		"dom",
		"javascript",
		"click",
		"fill",
		"cookies",
		"network",
		"screenshot",
		"visual",
		"csp",
	];
	private readonly manager = new BrowserManager({ browser: { autoDetect: false } });
	private readonly profilePath: string;
	private browserContext: BrowserContext | null = null;
	private starting: Promise<BrowserContext> | null = null;
	private closed = false;
	private readonly workers = new Map<AbortSignal, Worker>();
	private browserPid: number | null = null;
	private browserIdentity: string | null = null;
	private readonly ownedChildren = new Map<number, string>();

	constructor(private readonly options: ChromiumEngineOptions = {}) {
		this.capabilities = new Set([
			...ChromiumEngine.BASE_CAPABILITIES,
			...(options.preparePage ? ["request-policy" as const] : []),
			...(options.getAuthenticatedContext ? ["authenticated-session" as const] : []),
		]);
		this.profilePath = path.resolve(options.profileRoot ?? ".apex/runtime", `chromium-${randomUUID()}`);
	}

	private async ensureBrowser(): Promise<BrowserContext> {
		if (this.closed) throw new BrowserEngineError("router-closed", "Chromium engine is closed", { dispatched: false });
		if (this.browserContext?.browser()?.isConnected()) return this.browserContext;
		if (this.starting) return this.starting;
		const starting = this.launchBrowser();
		this.starting = starting;
		try {
			return await starting;
		} finally {
			this.starting = null;
		}
	}

	private async launchBrowser(): Promise<BrowserContext> {
		if (this.browserContext) {
			if (this.browserPid !== null && this.readLiveProcessIdentity(this.browserPid) !== null)
				throw new BrowserEngineError(
					"cancellation-unconfirmed",
					"Disconnected Chromium is still running; stop the engine before restarting",
					{ engine: this.name, dispatched: false },
				);
			this.signalOwnedChildren();
			await this.manager.closeAll();
			this.browserContext = null;
			this.browserPid = null;
			this.browserIdentity = null;
			this.ownedChildren.clear();
		}
		await mkdir(this.profilePath, { recursive: true });
		const context = await this.manager.launch(
			{
				id: "hybrid-machine",
				class: "sandbox",
				purpose: "Isolated routed tasks",
				userDataDir: this.profilePath,
				metadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
			},
			false,
			"chromium",
			{ timeout: 15_000 },
		);
		this.browserContext = context;
		this.browserPid = null;
		this.browserIdentity = null;
		this.ownedChildren.clear();
		const browser = context.browser();
		if (browser) {
			const cdp = await browser.newBrowserCDPSession();
			try {
				const info = await cdp.send("SystemInfo.getProcessInfo");
				const pid = info.processInfo.find((entry) => entry.type === "browser")?.id;
				if (pid !== undefined && Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid) {
					this.browserPid = pid;
					this.browserIdentity = ["darwin", "linux"].includes(process.platform) ? this.readProcessIdentity(pid) : null;
				}
				this.rememberOwnedChildren(info.processInfo);
			} finally {
				await cdp.detach();
			}
		}
		if (this.closed)
			throw new BrowserEngineError("router-closed", "Chromium engine closed during launch", { dispatched: false });
		return context;
	}

	async execute(task: BrowserTask, signal: AbortSignal): Promise<unknown> {
		for (const capability of task.requiredCapabilities ?? []) {
			if (!this.capabilities.has(capability))
				throw new BrowserEngineError("unsupported-capability", `Chromium adapter is not configured for ${capability}`, {
					dispatched: false,
				});
		}
		let finish!: () => void;
		const worker: Worker = {
			borrowed: Boolean(task.authenticated),
			settled: new Promise<void>((resolve) => {
				finish = resolve;
			}),
			finish: () => finish(),
		};
		this.workers.set(signal, worker);
		const abort = () => {
			void this.closeWorker(worker).catch(() => {});
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			signal.throwIfAborted();
			this.options.validateTask?.(task);
			const startupAt = performance.now();
			if (task.authenticated) {
				const context = this.options.getAuthenticatedContext?.(task);
				if (!context)
					throw new BrowserEngineError(
						"unsupported-capability",
						"Authenticated tasks need an active Talox Chromium session; call launch() first",
						{ dispatched: false },
					);
				worker.page = await context.newPage();
			} else {
				const parent = await this.ensureBrowser();
				signal.throwIfAborted();
				const browser = parent.browser();
				if (!browser)
					throw new BrowserEngineError("engine-crashed", "Chromium browser disconnected", { dispatched: false });
				worker.context = await browser.newContext();
				worker.page = await worker.context.newPage();
			}
			signal.throwIfAborted();
			const page = worker.page;
			this.options.validateTask?.(task);
			await this.options.preparePage?.(page);
			signal.throwIfAborted();
			this.options.validateTask?.(task);
			this.timing("startup", startupAt, signal);
			page.setDefaultTimeout(task.timeoutMs ?? 30_000);
			const network: Array<{ url: string; status: number; type: string }> = [];
			page.on("response", (response) => {
				if (network.length >= 1000) return;
				const url = new URL(response.url());
				url.search = "";
				url.hash = "";
				url.username = "";
				url.password = "";
				network.push({ url: url.toString(), status: response.status(), type: response.request().resourceType() });
			});
			const navigationAt = performance.now();
			const response = await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: task.timeoutMs ?? 30_000 });
			this.timing("navigation", navigationAt, signal);
			if (response && response.status() >= 400)
				throw new BrowserEngineError("execution-failed", `Chromium navigation returned HTTP ${response.status()}`, {
					dispatched: false,
				});
			signal.throwIfAborted();
			this.options.validateTask?.(task);
			const executionAt = performance.now();
			const value = await this.perform(page, task, network);
			this.timing("execution", executionAt, signal);
			return value;
		} catch (error) {
			if (error instanceof BrowserEngineError) throw error;
			throw new BrowserEngineError(
				signal.aborted ? "operation-timeout" : "execution-failed",
				error instanceof Error ? error.message : "Chromium task failed",
				{ dispatched: true, cause: error },
			);
		} finally {
			signal.removeEventListener("abort", abort);
			try {
				await this.closeWorker(worker);
			} finally {
				this.workers.delete(signal);
				worker.finish();
			}
		}
	}

	private async perform(page: Page, task: BrowserTask, network: unknown[]): Promise<unknown> {
		switch (task.operation) {
			case "extract":
				return page.evaluate(() => {
					if (!document.body) throw new Error("No usable HTML document body");
					return {
						url: location.href,
						title: document.title,
						text: document.body?.textContent ?? "",
						links: Array.from(document.querySelectorAll("a")).map((link) => ({
							text: link.textContent ?? "",
							href: link.href,
						})),
						headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((heading) => ({
							level: Number(heading.tagName.slice(1)),
							text: heading.textContent ?? "",
						})),
					};
				});
			case "query":
				return page.evaluate(
					(selector) =>
						Array.from(document.querySelectorAll(selector)).map((element) => ({
							tag: element.tagName.toLowerCase(),
							text: element.textContent ?? "",
							attributes: Object.fromEntries(
								Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]),
							),
						})),
					this.require(task.selector, "selector"),
				);
			case "evaluate":
				return page.evaluate(this.require(task.expression, "expression"));
			case "click":
				await page.locator(this.require(task.selector, "selector")).click();
				return { performed: true };
			case "fill":
				await page.locator(this.require(task.selector, "selector")).fill(this.require(task.value, "value"));
				return { performed: true };
			case "cookies":
				return page.context().cookies([task.url]);
			case "network":
				return network;
			case "screenshot":
				return {
					encoding: "base64",
					mimeType: "image/png",
					data: (await page.screenshot({ fullPage: true })).toString("base64"),
				};
			default:
				throw new BrowserEngineError("unsupported-capability", "Unsupported Chromium operation", { dispatched: false });
		}
	}

	private require(value: string | undefined, field: string): string {
		if (value === undefined) throw new BrowserEngineError("invalid-task", `Missing ${field}`, { dispatched: false });
		return value;
	}

	private timing(phase: "startup" | "navigation" | "execution", started: number, signal: AbortSignal): void {
		try {
			this.options.onTiming?.({ phase, durationMs: performance.now() - started, signal });
		} catch {
			/* Diagnostics must not change the outcome of an executed action. */
		}
	}

	private async closeWorker(worker: Worker): Promise<void> {
		if (worker.context) await worker.context.close();
		else if (worker.page) await worker.page.close();
	}

	async cancel(signal: AbortSignal): Promise<void> {
		const worker = this.workers.get(signal);
		if (!worker) return;
		await this.closeWorker(worker);
		await worker.settled;
	}

	async getResourceUsage() {
		const browser = this.browserContext?.browser();
		if (!browser?.isConnected())
			return { rssBytes: null, cpuPercent: null, status: "unread" as const, error: "No active Chromium browser" };
		const cdp = await browser.newBrowserCDPSession();
		try {
			const info = await cdp.send("SystemInfo.getProcessInfo");
			return {
				...(await sampleBrowserProcesses(info.processInfo.map((process) => process.id))),
				workers: this.workers.size,
			};
		} finally {
			await cdp.detach();
		}
	}

	async close(): Promise<void> {
		this.closed = true;
		// Closing the owned browser must remain possible when a page close stalls.
		const workersClosing = Promise.allSettled(Array.from(this.workers.values(), (worker) => this.closeWorker(worker)));
		if (this.starting) await this.starting.catch(() => {});
		const browser = this.browserContext?.browser();
		let ownershipFailure: unknown;
		if (browser?.isConnected()) {
			try {
				const refresh = (async () => {
					const cdp = await browser.newBrowserCDPSession();
					try {
						const info = await cdp.send("SystemInfo.getProcessInfo");
						if (this.browserContext?.browser() === browser && browser.isConnected())
							this.rememberOwnedChildren(info.processInfo);
					} finally {
						await cdp.detach();
					}
				})();
				if (!(await this.settledWithin(refresh, 2_000)))
					throw new Error("Owned Chromium child process reading exceeded its deadline");
			} catch (error) {
				ownershipFailure = new BrowserEngineError("cancellation-unconfirmed", "Chromium child processes are unread", {
					engine: this.name,
					cause: error,
				});
			}
			const closing = browser.close();
			// Persistent-context close can stall under shared macOS load. Only the
			// browser PID reported by this owned CDP connection may be signalled.
			// Draining inherited process pipes can lag the main PID exit on macOS.
			if (!(await this.settledWithin(closing, 3_000))) {
				this.signalOwnedBrowser("SIGTERM");
				if (!(await this.settledWithin(closing, 2_000))) {
					this.signalOwnedBrowser("SIGKILL");
					this.signalOwnedChildren();
					if (!(await this.settledWithin(closing, 20_000)))
						throw new BrowserEngineError("cancellation-unconfirmed", "Owned Chromium process did not stop", {
							engine: this.name,
						});
				}
			}
		} else if (browser && this.browserPid !== null) {
			this.signalOwnedBrowser("SIGTERM");
			this.signalOwnedChildren();
			this.signalOwnedBrowser("SIGKILL");
			await this.waitOwnedBrowserExit();
		}
		await this.manager.closeAll();
		const workerCompletion = workersClosing.then((results) => {
			const failed = results.find((result) => result.status === "rejected");
			if (failed?.status === "rejected") throw failed.reason;
		});
		if (!(await this.settledWithin(workerCompletion, 5_000)))
			throw new BrowserEngineError("cancellation-unconfirmed", "Chromium worker pages did not close", {
				engine: this.name,
			});
		this.browserContext = null;
		this.browserPid = null;
		this.browserIdentity = null;
		this.ownedChildren.clear();
		await rm(this.profilePath, { recursive: true, force: true });
		if (ownershipFailure) throw ownershipFailure;
	}

	private async waitOwnedBrowserExit(): Promise<void> {
		const deadline = performance.now() + 5_000;
		while (this.browserPid !== null && this.readLiveProcessIdentity(this.browserPid) !== null) {
			if (performance.now() >= deadline)
				throw new BrowserEngineError("cancellation-unconfirmed", "Disconnected Chromium process did not stop", {
					engine: this.name,
				});
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
	}

	private rememberOwnedChildren(processes: Array<{ id: number }>): void {
		if (!["darwin", "linux"].includes(process.platform)) return;
		for (const { id: pid } of processes) {
			if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid)
				throw new BrowserEngineError("cancellation-unconfirmed", "Owned Chromium process identifiers are unread", {
					engine: this.name,
				});
			if (pid === this.browserPid) continue;
			const identity = this.readLiveProcessIdentity(pid);
			if (identity !== null) this.ownedChildren.set(pid, identity);
		}
	}

	/** CDP identifies this browser's children; lstart prevents signalling a reused PID. */
	private signalOwnedChildren(): void {
		for (const [pid, identity] of this.ownedChildren) {
			if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid)
				throw new BrowserEngineError("cancellation-unconfirmed", "Chromium child PID is unread; signalling refused", {
					engine: this.name,
				});
			try {
				process.kill(pid, 0);
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code === "ESRCH") continue;
				throw cause;
			}
			const currentIdentity = this.readLiveProcessIdentity(pid);
			if (currentIdentity === null) continue;
			if (currentIdentity !== identity)
				throw new BrowserEngineError("cancellation-unconfirmed", "Chromium child identity changed; signalling refused", {
					engine: this.name,
				});
			try {
				process.kill(pid, "SIGKILL");
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
			}
		}
	}

	private signalOwnedBrowser(signal: "SIGTERM" | "SIGKILL"): void {
		if (!this.browserContext?.browser()) return;
		if (
			!Number.isSafeInteger(this.browserPid) ||
			!this.browserPid ||
			this.browserPid <= 0 ||
			this.browserPid === process.pid
		)
			throw new BrowserEngineError(
				"cancellation-unconfirmed",
				"Owned Chromium PID is unread; process signalling is refused",
				{ engine: this.name },
			);
		try {
			process.kill(this.browserPid, 0);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ESRCH") return;
			throw cause;
		}
		const currentIdentity = this.readLiveProcessIdentity(this.browserPid);
		if (currentIdentity === null) return;
		if (!this.browserIdentity || currentIdentity !== this.browserIdentity)
			throw new BrowserEngineError(
				"cancellation-unconfirmed",
				"Chromium process identity changed; process signalling is refused",
				{ engine: this.name },
			);
		try {
			process.kill(this.browserPid, signal);
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
		}
	}

	private readLiveProcessIdentity(pid: number): string | null {
		try {
			return this.readProcessIdentity(pid);
		} catch (error) {
			try {
				process.kill(pid, 0);
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code === "ESRCH") return null;
				throw cause;
			}
			throw error;
		}
	}

	private readProcessIdentity(pid: number): string {
		if (process.platform !== "darwin" && process.platform !== "linux")
			throw new BrowserEngineError("cancellation-unconfirmed", "Chromium process identity is unread on this platform", {
				engine: this.name,
			});
		const identity = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
			encoding: "utf8",
			timeout: 2_000,
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		if (!identity)
			throw new BrowserEngineError("cancellation-unconfirmed", "Chromium process identity is unread", {
				engine: this.name,
			});
		return identity;
	}

	private async settledWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise.then(() => true),
				new Promise<boolean>((resolve) => {
					timer = setTimeout(() => resolve(false), timeoutMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}
