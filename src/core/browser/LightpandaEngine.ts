import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { CdpConnection } from "./CdpConnection.js";
import { sampleBrowserProcesses } from "./ResourceMonitor.js";
import {
	type BrowserCapability,
	type BrowserEngineAdapter,
	BrowserEngineError,
	type BrowserResourceUsage,
	type BrowserTask,
} from "./types.js";

export interface LightpandaEngineOptions {
	executablePath?: string;
	startupTimeoutMs?: number;
	shutdownTimeoutMs?: number;
	maxWorkers?: number;
	onTiming?: (timing: {
		phase: "startup" | "navigation" | "execution";
		durationMs: number;
		signal: AbortSignal;
	}) => void;
}

interface Worker {
	process?: ChildProcess;
	connection?: CdpConnection;
	sessionId?: string;
	dispatched: boolean;
	settled: Promise<void>;
	finish: () => void;
	stopping?: Promise<void>;
	deadline: number;
	startupDeadline?: number;
	signal: AbortSignal;
	cancelled?: boolean;
}

/** Pinned Lightpanda 1.0.0 has no rendering or CSP enforcement. */
export class LightpandaEngine implements BrowserEngineAdapter {
	readonly name = "lightpanda" as const;
	readonly capabilities: ReadonlySet<BrowserCapability> = new Set([
		"navigation",
		"dom",
		"javascript",
		"click",
		"fill",
		"cookies",
		"network",
	]);
	private readonly executablePath: string;
	private readonly startupTimeoutMs: number;
	private readonly shutdownTimeoutMs: number;
	private readonly maxWorkers: number;
	private readonly workers = new Map<AbortSignal, Worker>();
	private closed = false;

	constructor(private readonly options: LightpandaEngineOptions = {}) {
		this.executablePath = path.resolve(
			options.executablePath ?? process.env.TALOX_LIGHTPANDA_PATH ?? ".apex/cache/lightpanda/1.0.0/lightpanda",
		);
		this.startupTimeoutMs = this.positive(options.startupTimeoutMs ?? 10_000, "startupTimeoutMs");
		this.shutdownTimeoutMs = this.positive(options.shutdownTimeoutMs ?? 2_000, "shutdownTimeoutMs");
		this.maxWorkers = this.positive(options.maxWorkers ?? 8, "maxWorkers");
		if (!Number.isSafeInteger(this.maxWorkers))
			throw this.failure("invalid-task", "maxWorkers must be a positive integer");
	}

	async execute(task: BrowserTask, signal: AbortSignal): Promise<unknown> {
		this.preflight(task, signal);
		let finish!: () => void;
		const worker: Worker = {
			dispatched: false,
			signal,
			deadline: performance.now() + this.positive(task.timeoutMs ?? 30_000, "timeoutMs"),
			settled: new Promise<void>((resolve) => {
				finish = resolve;
			}),
			finish: () => finish(),
		};
		this.workers.set(signal, worker);
		const abort = () => {
			worker.connection?.close();
			void this.stopWorker(worker).catch(() => {});
		};
		signal.addEventListener("abort", abort, { once: true });
		try {
			const startupStart = performance.now();
			await this.start(worker);
			this.timing("startup", startupStart, signal);
			const network: Array<{ url: string; status: number; type: string }> = [];
			const removeNetworkListener = worker.connection!.onEvent((event) => {
				if (
					event.sessionId !== worker.sessionId ||
					event.method !== "Network.responseReceived" ||
					network.length >= 1000
				)
					return;
				const response = event.params.response;
				if (!response || typeof response !== "object") return;
				const entry = response as Record<string, unknown>;
				if (typeof entry.url !== "string" || typeof entry.status !== "number") return;
				network.push({
					url: this.safeNetworkUrl(entry.url),
					status: entry.status,
					type: String(event.params.type ?? "Other").toLowerCase(),
				});
			});
			try {
				if (task.operation === "network")
					await this.send(worker, "Network.enable", {
						maxTotalBufferSize: 4_000_000,
						maxResourceBufferSize: 1_000_000,
					});
				const navigationStart = performance.now();
				await this.navigate(worker, task.url);
				this.timing("navigation", navigationStart, signal);
				const executionStart = performance.now();
				const value = await this.perform(worker, task, network);
				this.timing("execution", executionStart, signal);
				return value;
			} finally {
				removeNetworkListener();
			}
		} catch (cause) {
			if (cause instanceof BrowserEngineError) {
				throw new BrowserEngineError(
					signal.aborted || worker.cancelled ? "operation-timeout" : cause.code,
					cause.message,
					{
						engine: this.name,
						dispatched: worker.dispatched,
						cause,
					},
				);
			}
			throw new BrowserEngineError(
				signal.aborted ? "operation-timeout" : "execution-failed",
				"Lightpanda task failed",
				{ engine: this.name, dispatched: worker.dispatched, cause },
			);
		} finally {
			signal.removeEventListener("abort", abort);
			try {
				await this.stopWorker(worker);
			} finally {
				this.workers.delete(signal);
				worker.finish();
			}
		}
	}

	private preflight(task: BrowserTask, signal: AbortSignal): void {
		if (this.closed) throw this.failure("router-closed", "Lightpanda engine is closed");
		if (signal.aborted) throw this.failure("operation-timeout", "Lightpanda task was cancelled before startup");
		if (this.workers.has(signal))
			throw this.failure("invalid-task", "Each Lightpanda execution requires its own AbortSignal");
		if (this.workers.size >= this.maxWorkers)
			throw this.failure("queue-full", `Lightpanda worker limit (${this.maxWorkers}) reached`);
		if (task.authenticated)
			throw this.failure(
				"unsupported-capability",
				"Authenticated sessions require Chromium; Lightpanda never imports another engine's session",
			);
		if (task.trustedContent !== true)
			throw this.failure(
				"unsupported-capability",
				"Lightpanda 1.0.0 does not enforce CSP; use Chromium or explicitly declare controlled content with trustedContent: true",
			);
		for (const capability of task.requiredCapabilities ?? []) {
			if (!this.capabilities.has(capability))
				throw this.failure("unsupported-capability", `Lightpanda does not support ${capability}`);
		}
		if (task.operation === "screenshot")
			throw this.failure("unsupported-capability", "Lightpanda has no visual rendering; screenshots require Chromium");
		let url: URL;
		try {
			url = new URL(task.url);
		} catch {
			throw this.failure("invalid-task", "Lightpanda task URL must be an absolute HTTP(S) URL");
		}
		if (url.protocol !== "http:" && url.protocol !== "https:")
			throw this.failure("invalid-task", "Lightpanda supports only HTTP(S) task URLs");
		if ((task.operation === "query" || task.operation === "click" || task.operation === "fill") && !task.selector)
			throw this.failure("invalid-task", `${task.operation} requires a selector`);
		if (task.operation === "evaluate" && !task.expression)
			throw this.failure("invalid-task", "evaluate requires an expression");
		if (task.operation === "fill" && task.value === undefined)
			throw this.failure("invalid-task", "fill requires a value");
		if (!["extract", "query", "evaluate", "click", "fill", "cookies", "network"].includes(task.operation))
			throw this.failure("unsupported-capability", "Unknown Lightpanda operation");
	}

	private async start(worker: Worker): Promise<void> {
		try {
			await access(this.executablePath, constants.X_OK);
		} catch (cause) {
			throw new BrowserEngineError(
				"not-installed",
				`lightpanda not installed: run node scripts/install-lightpanda.mjs, then set TALOX_LIGHTPANDA_PATH or lightpanda.executablePath (${this.executablePath})`,
				{ engine: this.name, dispatched: false, cause },
			);
		}
		this.checkWorker(worker);
		const startupDeadline = Math.min(worker.deadline, performance.now() + this.startupTimeoutMs);
		worker.startupDeadline = startupDeadline;
		await this.version(worker, startupDeadline);
		delete worker.process;
		this.checkWorker(worker);
		const port = await this.freePort();
		this.checkWorker(worker);
		const child = spawn(this.executablePath, ["serve", "--host", "127.0.0.1", "--port", String(port)], {
			env: this.childEnvironment(),
			stdio: ["ignore", "ignore", "pipe"],
		});
		worker.process = child;
		// Consume bounded diagnostic output without logging page URLs or environment data.
		child.stderr?.resume();
		let spawnFailure: Error | undefined;
		child.once("error", (error) => {
			spawnFailure = error;
		});
		while (performance.now() < startupDeadline) {
			this.checkWorker(worker);
			if (spawnFailure || child.exitCode !== null || child.signalCode !== null)
				throw new BrowserEngineError("startup-failed", "Lightpanda exited before its CDP endpoint became ready", {
					engine: this.name,
					dispatched: false,
					cause: spawnFailure,
				});
			try {
				worker.connection = await CdpConnection.connect(
					`ws://127.0.0.1:${port}`,
					Math.min(250, this.remaining(worker)),
					worker.signal,
				);
				break;
			} catch (cause) {
				this.checkWorker(worker);
				if (!(cause instanceof BrowserEngineError) || cause.code !== "startup-failed") throw cause;
				await this.pause(worker, 30);
			}
		}
		if (!worker.connection) throw this.failure("startup-failed", "Lightpanda CDP startup deadline exceeded");
		const target = await this.send(worker, "Target.createTarget", { url: "about:blank" });
		if (typeof target.targetId !== "string")
			throw this.failure("startup-failed", "Lightpanda did not return a CDP target");
		const attached = await this.send(worker, "Target.attachToTarget", { targetId: target.targetId, flatten: true });
		if (typeof attached.sessionId !== "string")
			throw this.failure("startup-failed", "Lightpanda did not return a CDP session");
		worker.sessionId = attached.sessionId;
		await this.send(worker, "Page.enable");
		await this.send(worker, "Runtime.enable");
		// Real DOM/JS probing verifies behaviour, rather than assuming CDP implies compatibility.
		const probe = await this.evaluate(
			worker,
			`(() => { const p = document.createElement('div'); p.innerHTML = '<span>talox-probe</span>'; return { math: 1 + 1, dom: typeof document.querySelectorAll === 'function' && p.querySelector('span').textContent === 'talox-probe' }; })()`,
		);
		if (
			!probe ||
			typeof probe !== "object" ||
			(probe as Record<string, unknown>).math !== 2 ||
			(probe as Record<string, unknown>).dom !== true
		)
			throw this.failure("broken-dom", "Lightpanda DOM/JavaScript capability probe failed");
		delete worker.startupDeadline;
	}

	private version(worker: Worker, deadline: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const child = spawn(this.executablePath, ["version"], {
				env: this.childEnvironment(),
				stdio: ["ignore", "pipe", "ignore"],
			});
			worker.process = child;
			let output = "";
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (error) reject(error);
				else resolve();
			};
			const timer = setTimeout(
				() => {
					child.kill("SIGKILL");
					finish(this.failure("startup-failed", "Lightpanda version probe timed out"));
				},
				Math.max(1, deadline - performance.now()),
			);
			child.stdout?.on("data", (chunk: Buffer) => {
				output += chunk.toString();
				if (output.length > 4096) {
					child.kill("SIGKILL");
					finish(this.failure("startup-failed", "Lightpanda version probe returned excessive output"));
				}
			});
			child.once("error", (cause) =>
				finish(
					new BrowserEngineError("startup-failed", "Could not execute Lightpanda version probe", {
						engine: this.name,
						dispatched: false,
						cause,
					}),
				),
			);
			child.once("close", (code) => {
				if (code !== 0 || output.trim() !== "1.0.0")
					finish(
						this.failure(
							"startup-failed",
							"Lightpanda version must be pinned 1.0.0; install with node scripts/install-lightpanda.mjs",
						),
					);
				else finish();
			});
		});
	}

	private async navigate(worker: Worker, url: string): Promise<void> {
		let loaded = false;
		const remove = worker.connection!.onEvent((event) => {
			if (event.method === "Page.loadEventFired" && event.sessionId === worker.sessionId) loaded = true;
		});
		try {
			const navigation = await this.send(worker, "Page.navigate", { url });
			if (navigation.errorText) throw this.failure("execution-failed", "Lightpanda navigation failed");
			while (!loaded) {
				this.checkWorker(worker);
				await this.pause(worker, 10);
			}
			const dom = await this.evaluate(
				worker,
				`({url: location.href, ready: document.readyState, body: !!document.body, root: !!document.documentElement})`,
			);
			if (
				!dom ||
				typeof dom !== "object" ||
				!(dom as Record<string, unknown>).root ||
				!(dom as Record<string, unknown>).body
			)
				throw this.failure("broken-dom", "Lightpanda navigation produced no usable HTML DOM");
			const state = dom as Record<string, unknown>;
			if (
				typeof state.url !== "string" ||
				!/^https?:\/\//.test(state.url) ||
				(state.ready !== "interactive" && state.ready !== "complete")
			)
				throw this.failure("broken-dom", "Lightpanda navigation did not produce a loaded HTTP(S) document");
		} finally {
			remove();
		}
	}

	private async perform(worker: Worker, task: BrowserTask, network: unknown[]): Promise<unknown> {
		switch (task.operation) {
			case "extract":
				return this.evaluate(
					worker,
					`(() => { if (!document.body) throw new Error('No document body'); return { url: location.href, title: document.title, text: document.body.textContent, links: Array.from(document.querySelectorAll('a')).map(a => ({ text: a.textContent ?? '', href: a.href })), headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => ({level: Number(h.tagName.slice(1)),text: h.textContent ?? ''})) }; })()`,
				);
			case "query":
				return this.evaluate(
					worker,
					`Array.from(document.querySelectorAll(${JSON.stringify(task.selector)})).map(e => ({tag: e.tagName.toLowerCase(), text: e.textContent ?? '', attributes: Object.fromEntries(Array.from(e.attributes).map(a => [a.name, a.value]))}))`,
				);
			case "evaluate":
				worker.dispatched = true;
				return this.evaluate(worker, task.expression!);
			case "click": {
				const valid = await this.evaluate(
					worker,
					`(() => { const e = document.querySelector(${JSON.stringify(task.selector)}); return !!e && typeof e.click === 'function' && !e.disabled; })()`,
				);
				if (valid !== true)
					throw this.failure("execution-failed", "Lightpanda click target is missing, disabled, or unsupported");
				worker.dispatched = true;
				const result = await this.evaluate(
					worker,
					`(() => { const e = document.querySelector(${JSON.stringify(task.selector)}); if (!e || e.disabled || typeof e.click !== 'function') throw new Error('Click target became unavailable'); e.click(); return {performed: true}; })()`,
				);
				if (!result || typeof result !== "object" || (result as Record<string, unknown>).performed !== true)
					throw this.failure("execution-failed", "Lightpanda did not confirm click dispatch");
				return result;
			}
			case "fill": {
				const valid = await this.evaluate(
					worker,
					`(() => { const e = document.querySelector(${JSON.stringify(task.selector)}); return !!e && /^(INPUT|TEXTAREA)$/.test(e.tagName) && !e.disabled && !e.readOnly && typeof Event === 'function'; })()`,
				);
				if (valid !== true)
					throw this.failure(
						"unsupported-capability",
						"Lightpanda fill supports enabled input and textarea elements only",
					);
				worker.dispatched = true;
				const result = await this.evaluate(
					worker,
					`(() => { const e = document.querySelector(${JSON.stringify(task.selector)}); if (!e || e.disabled || e.readOnly) throw new Error('Fill target became unavailable'); e.value = ${JSON.stringify(task.value)}; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); if (e.value !== ${JSON.stringify(task.value)}) throw new Error('Fill value verification failed'); return {performed:true}; })()`,
				);
				if (!result || typeof result !== "object" || (result as Record<string, unknown>).performed !== true)
					throw this.failure("execution-failed", "Lightpanda did not confirm form fill");
				return result;
			}
			case "cookies": {
				const result = await this.send(worker, "Network.getCookies", { urls: [task.url] });
				if (!Array.isArray(result.cookies))
					throw this.failure("execution-failed", "Lightpanda returned an unreadable cookie collection");
				return result.cookies;
			}
			case "network": {
				if (!network.length)
					throw this.failure("execution-failed", "Lightpanda emitted no readable network response events");
				return network;
			}
			default:
				throw this.failure("unsupported-capability", "Lightpanda operation is unsupported");
		}
	}

	private async evaluate(worker: Worker, expression: string): Promise<unknown> {
		const response = await this.send(worker, "Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (response.exceptionDetails)
			throw this.failure("execution-failed", "Lightpanda JavaScript execution raised an exception");
		const result = response.result;
		if (!result || typeof result !== "object")
			throw this.failure("execution-failed", "Lightpanda returned an unreadable JavaScript result");
		const remote = result as Record<string, unknown>;
		if (Object.hasOwn(remote, "value")) return remote.value;
		if (remote.type === "undefined") return undefined;
		throw this.failure("unsupported-capability", "Lightpanda JavaScript result is not serializable by value");
	}

	private send(worker: Worker, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		this.checkWorker(worker);
		return worker.connection!.send(method, params, {
			...(worker.sessionId ? { sessionId: worker.sessionId } : {}),
			signal: worker.signal,
			timeoutMs: this.remaining(worker),
			dispatched: worker.dispatched,
		});
	}

	async cancel(signal: AbortSignal): Promise<void> {
		const worker = this.workers.get(signal);
		if (!worker) return;
		worker.cancelled = true;
		worker.connection?.close();
		await this.stopWorker(worker);
		await worker.settled;
	}

	async getResourceUsage(): Promise<BrowserResourceUsage> {
		const pids = Array.from(this.workers.values()).flatMap((worker) =>
			worker.process?.pid && worker.process.exitCode === null && worker.process.signalCode === null
				? [worker.process.pid]
				: [],
		);
		return { ...(await sampleBrowserProcesses(pids)), workers: pids.length };
	}

	async close(): Promise<void> {
		this.closed = true;
		const active = Array.from(this.workers.values());
		await Promise.all(
			active.map(async (worker) => {
				worker.connection?.close();
				await this.stopWorker(worker);
			}),
		);
		await Promise.all(active.map((worker) => worker.settled));
	}

	private stopWorker(worker: Worker): Promise<void> {
		if (worker.stopping) return worker.stopping;
		worker.connection?.close();
		worker.stopping = this.stopChild(worker.process);
		return worker.stopping;
	}

	private stopChild(child?: ChildProcess): Promise<void> {
		if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
		return new Promise((resolve, reject) => {
			let forced = false;
			const timer = setTimeout(() => {
				forced = true;
				child.kill("SIGKILL");
			}, this.shutdownTimeoutMs / 2);
			const finalTimer = setTimeout(() => {
				cleanup();
				reject(this.failure("cancellation-unconfirmed", "Lightpanda worker termination could not be confirmed"));
			}, this.shutdownTimeoutMs);
			const cleanup = () => {
				clearTimeout(timer);
				clearTimeout(finalTimer);
				child.off("exit", exit);
				child.off("error", error);
			};
			const exit = () => {
				cleanup();
				resolve();
			};
			const error = () => {
				if (!child.pid) {
					cleanup();
					resolve();
				} else if (forced) {
					cleanup();
					reject(this.failure("cancellation-unconfirmed", "Lightpanda worker termination failed"));
				}
			};
			child.once("exit", exit);
			child.once("error", error);
			// ChildProcess.kill targets the positive PID of this exact owned child; never a process group.
			child.kill("SIGTERM");
		});
	}

	private childEnvironment(): NodeJS.ProcessEnv {
		// Do not inherit credentials or proxy configuration from the agent environment.
		return {
			PATH: process.env.PATH,
			LANG: "C.UTF-8",
			LIGHTPANDA_DISABLE_TELEMETRY: "true",
			LIGHTPANDA_DISABLE_CORE_DUMP: "1",
		};
	}

	private checkWorker(worker: Worker): void {
		if (this.closed || worker.signal.aborted || worker.cancelled)
			throw this.failure("operation-timeout", "Lightpanda operation cancelled");
		if (performance.now() >= Math.min(worker.deadline, worker.startupDeadline ?? worker.deadline))
			throw this.failure("operation-timeout", "Lightpanda operation deadline exceeded");
		if (worker.process && (worker.process.exitCode !== null || worker.process.signalCode !== null))
			throw this.failure("engine-crashed", "Lightpanda worker exited during execution");
	}

	private remaining(worker: Worker): number {
		return Math.max(1, Math.min(worker.deadline, worker.startupDeadline ?? worker.deadline) - performance.now());
	}
	private pause(worker: Worker, milliseconds: number): Promise<void> {
		return new Promise((resolve, reject) => {
			if (worker.signal.aborted) {
				reject(this.failure("operation-timeout", "Lightpanda operation cancelled"));
				return;
			}
			const done = () => {
				worker.signal.removeEventListener("abort", abort);
				resolve();
			};
			const timer = setTimeout(done, Math.min(milliseconds, this.remaining(worker)));
			const abort = () => {
				clearTimeout(timer);
				worker.signal.removeEventListener("abort", abort);
				reject(this.failure("operation-timeout", "Lightpanda operation cancelled"));
			};
			worker.signal.addEventListener("abort", abort, { once: true });
		});
	}
	private freePort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const server = createServer();
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (!address || typeof address === "string") {
					server.close();
					reject(this.failure("startup-failed", "Could not reserve a Lightpanda CDP port"));
					return;
				}
				server.close((error) => (error ? reject(error) : resolve(address.port)));
			});
		});
	}
	private timing(phase: "startup" | "navigation" | "execution", started: number, signal: AbortSignal): void {
		try {
			this.options.onTiming?.({ phase, durationMs: performance.now() - started, signal });
		} catch {
			/* Diagnostics cannot change task execution. */
		}
	}
	private safeNetworkUrl(value: string): string {
		try {
			const url = new URL(value);
			url.search = "";
			url.hash = "";
			url.username = "";
			url.password = "";
			return url.toString();
		} catch {
			return "unread";
		}
	}
	private positive(value: number, field: string): number {
		if (!Number.isFinite(value) || value <= 0)
			throw this.failure("invalid-task", `${field} must be a positive finite number`);
		return value;
	}
	private failure(code: ConstructorParameters<typeof BrowserEngineError>[0], message: string): BrowserEngineError {
		return new BrowserEngineError(code, message, { engine: this.name, dispatched: false });
	}
}
