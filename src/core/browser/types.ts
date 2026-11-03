/** Hybrid tasks are additive; the frozen TaloxPageState v1 contract is unchanged. */
export type EngineName = "lightpanda" | "chromium";
export type EngineMode = "auto" | "machine" | "human";

export type BrowserCapability =
	| "csp"
	| "request-policy"
	| "navigation"
	| "dom"
	| "javascript"
	| "click"
	| "fill"
	| "cookies"
	| "network"
	| "screenshot"
	| "visual"
	| "human-takeover"
	| "authenticated-session";

/** Each task uses its own session. Authenticated tasks explicitly use Chromium. */
export interface BrowserTask {
	url: string;
	operation: "extract" | "query" | "evaluate" | "click" | "fill" | "cookies" | "network" | "screenshot";
	selector?: string;
	expression?: string;
	value?: string;
	requiredCapabilities?: BrowserCapability[];
	authenticated?: boolean;
	/** Caller asserts controlled content whose security does not depend on CSP. */
	trustedContent?: boolean;
	/** Only an explicit readOnly evaluate is replayable. Never overrides click/fill. */
	readOnly?: boolean;
	/** Deadline per attempt; cancellation has its own bounded recovery deadline. */
	timeoutMs?: number;
}

export type BrowserFailureCode =
	| "not-installed"
	| "startup-failed"
	| "unsupported-capability"
	| "unsupported-command"
	| "broken-dom"
	| "engine-crashed"
	| "operation-timeout"
	| "execution-failed"
	| "queue-full"
	| "router-closed"
	| "invalid-task"
	| "unsafe-replay"
	| "cancellation-unconfirmed"
	| "site-unreliable"
	| "authenticated-session";

export class BrowserEngineError extends Error {
	readonly code: BrowserFailureCode;
	readonly dispatched: boolean;
	readonly engine: EngineName | undefined;

	constructor(
		code: BrowserFailureCode,
		message: string,
		options: { dispatched?: boolean; engine?: EngineName; cause?: unknown } = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "BrowserEngineError";
		this.code = code;
		// Unknown errors are ambiguous. Only adapters can prove no action was sent.
		this.dispatched = options.dispatched ?? true;
		this.engine = options.engine;
	}
}

export interface BrowserResourceUsage {
	rssBytes: number | null;
	cpuPercent?: number | null;
	workers?: number;
	status?: "available" | "unread" | "error";
	error?: string;
}

export interface BrowserEngineAdapter {
	readonly name: EngineName;
	readonly capabilities: ReadonlySet<BrowserCapability>;
	/** Reject only once this execution is quiescent; signal cancellation is mandatory. */
	execute(task: BrowserTask, signal: AbortSignal): Promise<unknown>;
	/** Cancel only the execution identified by signal, awaiting worker termination. */
	cancel?(signal: AbortSignal): Promise<void>;
	getResourceUsage?(): Promise<BrowserResourceUsage>;
	close(): Promise<void>;
}

export interface BrowserEngineConfig {
	mode?: EngineMode;
	lightpanda?: { executablePath?: string; startupTimeoutMs?: number };
	concurrency?: Partial<Record<EngineName, number>>;
	maxQueueSize?: number;
	operationTimeoutMs?: number;
	recoveryTimeoutMs?: number;
	/** Graceful browser shutdown can take longer than per-task cancellation. */
	shutdownTimeoutMs?: number;
	/** Consecutive failures for a hostname before AUTO selects Chromium. */
	reliabilityThreshold?: number;
}

export interface BrowserFallback {
	from: EngineName;
	to: EngineName;
	reason: BrowserFailureCode;
	message: string;
}

export interface BrowserTaskResult {
	engine: EngineName;
	value: unknown;
	durationMs: number;
	fallback?: BrowserFallback;
}

export interface BrowserEngineCounters {
	activeWorkers: number;
	queuedTasks: number;
	tasksCompleted: number;
	tasksFailed: number;
	averageLatencyMs: number;
	ramBytes: number | null;
	cpuPercent: number | null;
	resourceStatus: "available" | "unread" | "error";
	resourceError?: string;
}

export interface BrowserEngineTelemetrySnapshot {
	mode: EngineMode;
	activeEngine: EngineName | "mixed" | null;
	runningWorkers: number;
	queuedTasks: number;
	ramBytes: number | null;
	tasksCompleted: number;
	tasksFailed: number;
	averageLatencyMs: number;
	/** Failed attempts / all completed attempts, including attempts before fallback. */
	errorRate: number;
	fallbackCount: number;
	lastFallback?: BrowserFallback;
	engines: Record<EngineName, BrowserEngineCounters>;
}
