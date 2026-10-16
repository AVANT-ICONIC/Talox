import type {
	BrowserEngineCounters,
	BrowserEngineTelemetrySnapshot,
	BrowserFallback,
	BrowserResourceUsage,
	EngineMode,
	EngineName,
} from "./types.js";

/** In-memory counters contain no task URLs, expressions, cookies, or credentials. */
export class BrowserTelemetry {
	private readonly counters: Record<EngineName, BrowserEngineCounters> = {
		lightpanda: this.emptyCounters(),
		chromium: this.emptyCounters(),
	};
	private readonly durationTotals: Record<EngineName, number> = { lightpanda: 0, chromium: 0 };
	private fallbackCount = 0;
	private lastFallback: BrowserFallback | undefined;

	private emptyCounters(): BrowserEngineCounters {
		return {
			activeWorkers: 0,
			queuedTasks: 0,
			tasksCompleted: 0,
			tasksFailed: 0,
			averageLatencyMs: 0,
			ramBytes: null,
			cpuPercent: null,
			resourceStatus: "unread",
		};
	}

	queued(engine: EngineName, delta: number): void {
		this.counters[engine].queuedTasks += delta;
	}

	started(engine: EngineName): void {
		this.counters[engine].activeWorkers++;
	}

	finished(engine: EngineName, durationMs: number, succeeded: boolean): void {
		const counters = this.counters[engine];
		counters.activeWorkers--;
		if (succeeded) counters.tasksCompleted++;
		else counters.tasksFailed++;
		this.durationTotals[engine] += durationMs;
		counters.averageLatencyMs = this.durationTotals[engine] / (counters.tasksCompleted + counters.tasksFailed);
	}

	fallback(value: BrowserFallback): void {
		this.fallbackCount++;
		this.lastFallback = { ...value };
	}

	resources(engine: EngineName, usage: BrowserResourceUsage): void {
		const counters = this.counters[engine];
		if (usage.rssBytes !== null && (!Number.isFinite(usage.rssBytes) || usage.rssBytes < 0)) {
			this.resourceError(engine, "Engine returned an invalid RAM reading");
			return;
		}
		counters.ramBytes = usage.rssBytes;
		counters.cpuPercent = usage.cpuPercent ?? null;
		counters.resourceStatus = usage.status ?? (usage.rssBytes === null ? "unread" : "available");
		if (usage.error) counters.resourceError = usage.error;
		else delete counters.resourceError;
	}

	resourceError(engine: EngineName, message: string): void {
		const counters = this.counters[engine];
		counters.ramBytes = null;
		counters.cpuPercent = null;
		counters.resourceStatus = "error";
		counters.resourceError = message;
	}

	snapshot(mode: EngineMode): BrowserEngineTelemetrySnapshot {
		const lightpanda = { ...this.counters.lightpanda };
		const chromium = { ...this.counters.chromium };
		const active = (Object.entries(this.counters) as Array<[EngineName, BrowserEngineCounters]>)
			.filter(([, value]) => value.activeWorkers > 0)
			.map(([engine]) => engine);
		const completed = lightpanda.tasksCompleted + chromium.tasksCompleted;
		const failed = lightpanda.tasksFailed + chromium.tasksFailed;
		const attempts = completed + failed;
		// Reused browsers consume RAM even with no running tasks. Failed readings
		// remain required; they cannot disappear merely because an engine is idle.
		const readings = [lightpanda, chromium].filter(
			(engine) =>
				engine.resourceStatus === "available" ||
				engine.resourceStatus === "error" ||
				engine.activeWorkers > 0 ||
				engine.ramBytes !== null,
		);
		const ramBytes =
			readings.length === 0
				? null
				: readings.reduce<number | null>((total, engine) => {
						return total === null || engine.ramBytes === null || engine.resourceStatus !== "available"
							? null
							: total + engine.ramBytes;
					}, 0);
		return {
			mode,
			activeEngine: active.length > 1 ? "mixed" : (active[0] ?? null),
			runningWorkers: lightpanda.activeWorkers + chromium.activeWorkers,
			queuedTasks: lightpanda.queuedTasks + chromium.queuedTasks,
			ramBytes,
			tasksCompleted: completed,
			tasksFailed: failed,
			averageLatencyMs: attempts === 0 ? 0 : (this.durationTotals.lightpanda + this.durationTotals.chromium) / attempts,
			errorRate: attempts === 0 ? 0 : failed / attempts,
			fallbackCount: this.fallbackCount,
			...(this.lastFallback ? { lastFallback: { ...this.lastFallback } } : {}),
			engines: { lightpanda, chromium },
		};
	}
}
