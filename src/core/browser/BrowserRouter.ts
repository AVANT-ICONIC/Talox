import { BrowserTelemetry } from "./BrowserTelemetry.js";
import {
	type BrowserCapability,
	type BrowserEngineAdapter,
	type BrowserEngineConfig,
	BrowserEngineError,
	type BrowserEngineTelemetrySnapshot,
	type BrowserFallback,
	type BrowserTask,
	type BrowserTaskResult,
	type EngineMode,
	type EngineName,
} from "./types.js";

export interface BrowserRouterOptions extends Omit<BrowserEngineConfig, "lightpanda"> {
	chromium: BrowserEngineAdapter;
	lightpanda?: BrowserEngineAdapter;
	/** Revalidate captured security/session context after queue admission, before dispatch. */
	beforeDispatch?: (task: BrowserTask, engine: EngineName) => void;
}

interface QueueEntry {
	resolve: (release: () => void) => void;
	reject: (error: unknown) => void;
	signal: AbortSignal;
	abort: () => void;
}

const OPERATION_CAPABILITIES: Record<BrowserTask["operation"], BrowserCapability[]> = {
	extract: ["dom", "javascript"],
	query: ["dom", "javascript"],
	evaluate: ["javascript"],
	click: ["dom", "click"],
	fill: ["dom", "fill"],
	cookies: ["cookies"],
	network: ["network"],
	screenshot: ["screenshot", "visual"],
};

export function requiredCapabilities(task: BrowserTask): ReadonlySet<BrowserCapability> {
	return new Set([
		"navigation",
		...OPERATION_CAPABILITIES[task.operation],
		...(task.requiredCapabilities ?? []),
		...(task.authenticated ? ["authenticated-session" as const] : []),
		...(task.trustedContent === true ? [] : ["csp" as const]),
	]);
}

export function isReplaySafe(task: BrowserTask): boolean {
	if (task.operation === "click" || task.operation === "fill") return false;
	return task.operation !== "evaluate" || task.readOnly === true;
}

/** Deterministic, bounded routing. No session or cookies are transferred between engines. */
export class BrowserRouter {
	private readonly adapters: Partial<Record<EngineName, BrowserEngineAdapter>>;
	private readonly limits: Record<EngineName, number>;
	private readonly active: Record<EngineName, number> = { lightpanda: 0, chromium: 0 };
	private readonly queues: Record<EngineName, QueueEntry[]> = { lightpanda: [], chromium: [] };
	private readonly controllers = new Set<AbortController>();
	private readonly tasks = new Set<Promise<BrowserTaskResult>>();
	private readonly executions = new Set<Promise<unknown>>();
	private readonly failures = new Map<string, number>();
	private readonly telemetry = new BrowserTelemetry();
	private readonly maxQueueSize: number;
	private readonly operationTimeoutMs: number;
	private readonly recoveryTimeoutMs: number;
	private readonly shutdownTimeoutMs: number;
	private readonly reliabilityThreshold: number;
	private readonly beforeDispatch: BrowserRouterOptions["beforeDispatch"];
	private mode: EngineMode;
	private closed = false;
	private closing: Promise<void> | undefined;

	constructor(options: BrowserRouterOptions) {
		this.adapters = { chromium: options.chromium, ...(options.lightpanda ? { lightpanda: options.lightpanda } : {}) };
		this.beforeDispatch = options.beforeDispatch;
		this.mode = options.mode ?? "auto";
		this.validateMode(this.mode);
		if (options.chromium.name !== "chromium" || (options.lightpanda && options.lightpanda.name !== "lightpanda")) {
			throw new BrowserEngineError("invalid-task", "Browser adapters must match their configured engine", {
				dispatched: false,
			});
		}
		this.limits = {
			lightpanda: this.positiveInteger(options.concurrency?.lightpanda ?? 2, "Lightpanda concurrency"),
			chromium: this.positiveInteger(options.concurrency?.chromium ?? 1, "Chromium concurrency"),
		};
		this.maxQueueSize = this.positiveInteger(options.maxQueueSize ?? 100, "Queue size", true);
		this.operationTimeoutMs = this.positiveInteger(options.operationTimeoutMs ?? 30_000, "Operation timeout");
		this.recoveryTimeoutMs = this.positiveInteger(options.recoveryTimeoutMs ?? 5_000, "Recovery timeout");
		this.shutdownTimeoutMs = this.positiveInteger(options.shutdownTimeoutMs ?? 30_000, "Shutdown timeout");
		this.reliabilityThreshold = this.positiveInteger(options.reliabilityThreshold ?? 2, "Reliability threshold");
	}

	setMode(mode: EngineMode): void {
		this.validateMode(mode);
		this.mode = mode;
	}

	getMode(): EngineMode {
		return this.mode;
	}

	getTelemetry(): BrowserEngineTelemetrySnapshot {
		return this.telemetry.snapshot(this.mode);
	}

	/** Failures to read resources remain observable and never become a zero reading. */
	async refreshResources(): Promise<BrowserEngineTelemetrySnapshot> {
		await Promise.all(
			(Object.entries(this.adapters) as Array<[EngineName, BrowserEngineAdapter]>).map(async ([name, adapter]) => {
				if (!adapter.getResourceUsage) return;
				try {
					const usage = await this.withDeadline(adapter.getResourceUsage(), this.recoveryTimeoutMs);
					this.telemetry.resources(name, usage);
				} catch (error) {
					this.telemetry.resourceError(name, error instanceof Error ? error.message : "Resource reading failed");
				}
			}),
		);
		return this.getTelemetry();
	}

	execute(task: BrowserTask, mode: EngineMode = this.mode): Promise<BrowserTaskResult> {
		// A caller must not change the replay classification while an attempt awaits.
		const snapshot: BrowserTask = {
			...task,
			...(task.requiredCapabilities ? { requiredCapabilities: [...task.requiredCapabilities] } : {}),
		};
		if (snapshot.requiredCapabilities) Object.freeze(snapshot.requiredCapabilities);
		Object.freeze(snapshot);
		const promise = this.route(snapshot, mode);
		this.tasks.add(promise);
		promise.then(
			() => this.tasks.delete(promise),
			() => this.tasks.delete(promise),
		);
		return promise;
	}

	private async route(task: BrowserTask, mode: EngineMode): Promise<BrowserTaskResult> {
		this.validateMode(mode);
		const hostname = this.validateTask(task);
		if (this.closed) throw new BrowserEngineError("router-closed", "Browser router is closed", { dispatched: false });
		const started = performance.now();
		const selection = this.select(task, mode, hostname);
		if (selection.fallback) this.telemetry.fallback(selection.fallback);
		try {
			const value = await this.attempt(selection.engine, task);
			if (selection.engine === "lightpanda") this.failures.delete(hostname);
			return {
				engine: selection.engine,
				value,
				durationMs: performance.now() - started,
				...(selection.fallback ? { fallback: selection.fallback } : {}),
			};
		} catch (cause) {
			const error = this.normalizeError(cause, selection.engine);
			if (
				selection.engine === "chromium" ||
				this.closed ||
				error.code === "cancellation-unconfirmed" ||
				error.code === "invalid-task"
			)
				throw error;
			this.failures.set(hostname, (this.failures.get(hostname) ?? 0) + 1);
			if (error.dispatched && !isReplaySafe(task)) {
				throw new BrowserEngineError(
					"unsafe-replay",
					"The Lightpanda action may have succeeded; automatic replay is blocked",
					{
						engine: "lightpanda",
						dispatched: true,
						cause: error,
					},
				);
			}
			const fallback = this.fallback(error.code, error.message);
			this.telemetry.fallback(fallback);
			const value = await this.attempt("chromium", task);
			return { engine: "chromium", value, durationMs: performance.now() - started, fallback };
		}
	}

	private select(
		task: BrowserTask,
		mode: EngineMode,
		hostname: string,
	): { engine: EngineName; fallback?: BrowserFallback } {
		if (mode === "human") return { engine: "chromium" };
		if (task.authenticated)
			return {
				engine: "chromium",
				fallback: this.fallback("authenticated-session", "Authenticated tasks require the Chromium session"),
			};
		const adapter = this.adapters.lightpanda;
		if (!adapter)
			return { engine: "chromium", fallback: this.fallback("not-installed", "Lightpanda is not configured") };
		const missing = [...requiredCapabilities(task)].filter((capability) => !adapter.capabilities.has(capability));
		if (missing.length)
			return {
				engine: "chromium",
				fallback: this.fallback("unsupported-capability", `Lightpanda does not support: ${missing.join(", ")}`),
			};
		if (mode === "auto" && (this.failures.get(hostname) ?? 0) >= this.reliabilityThreshold) {
			return {
				engine: "chromium",
				fallback: this.fallback(
					"site-unreliable",
					"Lightpanda reached the hostname failure threshold; MACHINE mode allows a new probe",
				),
			};
		}
		return { engine: "lightpanda" };
	}

	private async attempt(engine: EngineName, task: BrowserTask): Promise<unknown> {
		const adapter = this.adapters[engine];
		if (!adapter)
			throw new BrowserEngineError("not-installed", `${engine} is not configured`, { engine, dispatched: false });
		const missing = [...requiredCapabilities(task)].filter((capability) => !adapter.capabilities.has(capability));
		if (missing.length)
			throw new BrowserEngineError("unsupported-capability", `${engine} does not support: ${missing.join(", ")}`, {
				engine,
				dispatched: false,
			});
		const controller = new AbortController();
		this.controllers.add(controller);
		let dispatched = false;
		let release: (() => void) | undefined;
		let execution: Promise<unknown> | undefined;
		let settled = false;
		let quiescent = true;
		let started = performance.now();
		let succeeded = false;
		const timeoutMs = task.timeoutMs ?? this.operationTimeoutMs;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const aborted = new Promise<never>((_, reject) => {
			controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
			timer = setTimeout(
				() =>
					controller.abort(
						new BrowserEngineError("operation-timeout", `${engine} operation exceeded ${timeoutMs}ms`, {
							engine,
							dispatched,
						}),
					),
				timeoutMs,
			);
		});
		// Queue cancellation may reject before the promise is included in the race.
		void aborted.catch(() => undefined);
		try {
			release = await this.acquire(engine, controller.signal);
			started = performance.now();
			if (controller.signal.aborted) throw controller.signal.reason;
			try {
				this.beforeDispatch?.(task, engine);
			} catch (cause) {
				throw new BrowserEngineError(
					"invalid-task",
					cause instanceof BrowserEngineError ? cause.message : "Browser task context validation failed",
					{ engine, dispatched: false, cause },
				);
			}
			dispatched = true;
			execution = Promise.resolve(adapter.execute(task, controller.signal));
			this.executions.add(execution);
			execution.then(
				() => this.executions.delete(execution!),
				() => this.executions.delete(execution!),
			);
			execution.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			const value = await Promise.race([execution, aborted]);
			succeeded = true;
			return value;
		} catch (error) {
			if (controller.signal.aborted && execution && !settled) {
				try {
					await this.quiesce(adapter, controller.signal, execution, () => settled);
				} catch (cause) {
					quiescent = false;
					throw new BrowserEngineError(
						"cancellation-unconfirmed",
						`${engine} cancellation could not be confirmed; fallback is blocked`,
						{ engine, dispatched, cause },
					);
				}
			}
			throw this.normalizeError(error, engine);
		} finally {
			if (timer) clearTimeout(timer);
			this.controllers.delete(controller);
			const finish = () => {
				if (release) {
					this.telemetry.finished(engine, performance.now() - started, succeeded);
					release();
					release = undefined;
				}
			};
			if (quiescent || settled || !execution) finish();
			else execution.then(finish, finish);
		}
	}

	private async quiesce(
		adapter: BrowserEngineAdapter,
		signal: AbortSignal,
		execution: Promise<unknown>,
		settled: () => boolean,
	): Promise<void> {
		try {
			await this.withDeadline(
				adapter.cancel
					? adapter.cancel(signal)
					: execution.then(
							() => undefined,
							() => undefined,
						),
				this.recoveryTimeoutMs,
			);
		} catch (error) {
			if (!settled()) throw error;
		}
	}

	private acquire(engine: EngineName, signal: AbortSignal): Promise<() => void> {
		if (signal.aborted) return Promise.reject(signal.reason);
		if (this.active[engine] < this.limits[engine]) return Promise.resolve(this.occupy(engine));
		if (this.queues.lightpanda.length + this.queues.chromium.length >= this.maxQueueSize) {
			return Promise.reject(
				new BrowserEngineError("queue-full", "Browser task queue is full", { engine, dispatched: false }),
			);
		}
		return new Promise((resolve, reject) => {
			const entry: QueueEntry = {
				resolve,
				reject,
				signal,
				abort: () => {
					const index = this.queues[engine].indexOf(entry);
					if (index < 0) return;
					this.queues[engine].splice(index, 1);
					this.telemetry.queued(engine, -1);
					reject(signal.reason);
				},
			};
			this.queues[engine].push(entry);
			this.telemetry.queued(engine, 1);
			signal.addEventListener("abort", entry.abort, { once: true });
		});
	}

	private occupy(engine: EngineName): () => void {
		this.active[engine]++;
		this.telemetry.started(engine);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.active[engine]--;
			const next = this.queues[engine].shift();
			if (next) {
				this.telemetry.queued(engine, -1);
				next.signal.removeEventListener("abort", next.abort);
				next.resolve(this.occupy(engine));
			}
		};
	}

	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.closed = true;
		for (const controller of this.controllers)
			controller.abort(new BrowserEngineError("router-closed", "Browser router is closing", { dispatched: true }));
		this.closing = this.closeAdapters();
		return this.closing;
	}

	private async closeAdapters(): Promise<void> {
		const results = await Promise.allSettled(
			Object.values(this.adapters).map((adapter) => this.withDeadline(adapter.close(), this.shutdownTimeoutMs)),
		);
		try {
			await this.withDeadline(Promise.allSettled([...this.tasks]), this.shutdownTimeoutMs);
			await this.withDeadline(Promise.allSettled([...this.executions]), this.shutdownTimeoutMs);
		} catch (cause) {
			throw new BrowserEngineError(
				"cancellation-unconfirmed",
				"Browser shutdown could not confirm worker termination",
				{
					cause,
				},
			);
		}
		const failed = results.find((result) => result.status === "rejected");
		if (failed?.status === "rejected")
			throw new BrowserEngineError("cancellation-unconfirmed", "Browser shutdown failed", { cause: failed.reason });
	}

	private async withDeadline<T>(promise: Promise<T>, durationMs: number): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error("Recovery deadline exceeded")), durationMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private fallback(reason: BrowserFallback["reason"], message: string): BrowserFallback {
		return { from: "lightpanda", to: "chromium", reason, message };
	}

	private normalizeError(error: unknown, engine: EngineName): BrowserEngineError {
		if (error instanceof BrowserEngineError) return error;
		return new BrowserEngineError("execution-failed", `${engine} execution failed`, {
			engine,
			dispatched: true,
			cause: error,
		});
	}

	private validateMode(mode: EngineMode): void {
		if (!["auto", "machine", "human"].includes(mode))
			throw new BrowserEngineError("invalid-task", "Unknown browser engine mode", { dispatched: false });
	}

	private positiveInteger(value: number, label: string, allowZero = false): number {
		if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
			throw new BrowserEngineError(
				"invalid-task",
				`${label} must be a ${allowZero ? "nonnegative" : "positive"} integer`,
				{ dispatched: false },
			);
		return value;
	}

	private validateTask(task: BrowserTask): string {
		let url: URL;
		try {
			url = new URL(task.url);
		} catch {
			throw new BrowserEngineError("invalid-task", "Browser tasks require a valid HTTP or HTTPS URL", {
				dispatched: false,
			});
		}
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			!Object.hasOwn(OPERATION_CAPABILITIES, task.operation)
		) {
			throw new BrowserEngineError(
				"invalid-task",
				"Browser tasks require an HTTP or HTTPS URL without embedded credentials and a supported operation",
				{ dispatched: false },
			);
		}
		if (task.timeoutMs !== undefined) this.positiveInteger(task.timeoutMs, "Task timeout");
		return url.hostname;
	}
}
