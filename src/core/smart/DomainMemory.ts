/**
 * @file DomainMemory.ts
 * @description Per-domain strategy outcome memory for the Talox adaptation loop.
 *
 * `DomainMemory` records the outcome of every adaptation strategy per hostname.
 * The `AdaptationEngine` consults this before selecting a strategy — strategies
 * with a poor success rate on the current domain are de-prioritised.
 *
 * ### Design
 * - In-memory only (no disk I/O). Persistence across sessions requires the
 *   caller to call `toJSON()` / `fromJSON()` and store the result externally.
 * - One `DomainRecord` per hostname (eTLD+1 extracted from full URL).
 * - Each `DomainRecord` holds a map from strategy name → `StrategyScore`.
 * - `StrategyScore` uses a simple success-rate with exponential decay so
 *   stale data from old bot-detection encounters fades out naturally.
 *
 * @example
 * ```ts
 * const memory = new DomainMemory();
 *
 * // Record outcome after an adaptation
 * memory.record('https://reddit.com/login', 'stealth_escalation', true);
 *
 * // Query before selecting a strategy
 * const score = memory.getScore('https://reddit.com/r/all', 'stealth_escalation');
 * // score.successRate → 0–1
 * // score.attempts   → number of recorded attempts
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyScore {
	/** Name of the adaptation strategy (matches `AdaptationStrategy.name`). */
	strategy: string;
	/** Total number of recorded attempts for this strategy on this domain. */
	attempts: number;
	/** Number of successes (interaction completed without another detection event). */
	successes: number;
	/** Derived success rate 0–1 (successes / attempts). */
	successRate: number;
	/** Exponentially-weighted moving average of success rate (recency-sensitive). */
	ewmaSuccessRate: number;
	/** ISO timestamp of the most recent recording. */
	lastSeen: string;
}

export interface DomainRecord {
	/** Hostname (eTLD+1) this record belongs to. */
	hostname: string;
	/** Per-strategy score map (key = strategy name). */
	strategies: Record<string, StrategyScore>;
	/** ISO timestamp when this record was first created. */
	createdAt: string;
	/** ISO timestamp when this record was last updated. */
	updatedAt: string;
	/** Total interaction events recorded for this domain. */
	totalEvents: number;
}

export interface DomainMemorySnapshot {
	version: 1;
	exportedAt: string;
	domains: Record<string, DomainRecord>;
}

// ─── DomainMemory ─────────────────────────────────────────────────────────────

/**
 * In-memory per-domain strategy outcome tracker.
 *
 * Thread-safe for single-process use (Node.js is single-threaded).
 */
export class DomainMemory {
	/** EWMA smoothing factor — higher = more weight on recent outcomes. */
	private readonly alpha: number;
	private readonly records = new Map<string, DomainRecord>();

	constructor(options: { ewmaAlpha?: number } = {}) {
		this.alpha = Math.max(0.05, Math.min(0.95, options.ewmaAlpha ?? 0.3));
	}

	// ─── Record ─────────────────────────────────────────────────────────────────

	/**
	 * Record an adaptation strategy outcome.
	 *
	 * @param url      Full URL of the page where the adaptation was applied.
	 * @param strategy Name of the `AdaptationStrategy` that was applied.
	 * @param success  True if the adaptation resolved the detection signal.
	 */
	record(url: string, strategy: string, success: boolean): void {
		const hostname = this.extractHostname(url);
		const now = new Date().toISOString();

		let record = this.records.get(hostname);
		if (!record) {
			record = {
				hostname,
				strategies: {},
				createdAt: now,
				updatedAt: now,
				totalEvents: 0,
			};
			this.records.set(hostname, record);
		}

		record.updatedAt = now;
		record.totalEvents++;

		const existing = record.strategies[strategy];
		if (!existing) {
			record.strategies[strategy] = {
				strategy,
				attempts: 1,
				successes: success ? 1 : 0,
				successRate: success ? 1 : 0,
				ewmaSuccessRate: success ? 1 : 0,
				lastSeen: now,
			};
			return;
		}

		existing.attempts++;
		if (success) existing.successes++;
		existing.successRate = existing.successes / existing.attempts;
		// Exponential moving average — blends historical rate with newest outcome
		existing.ewmaSuccessRate = this.alpha * (success ? 1 : 0) + (1 - this.alpha) * existing.ewmaSuccessRate;
		existing.lastSeen = now;
	}

	// ─── Query ──────────────────────────────────────────────────────────────────

	/**
	 * Get the strategy score for a (url, strategy) pair.
	 * Returns null if the strategy has never been recorded for this domain.
	 */
	getScore(url: string, strategy: string): StrategyScore | null {
		const hostname = this.extractHostname(url);
		return this.records.get(hostname)?.strategies[strategy] ?? null;
	}

	/**
	 * Return the best-known strategy for a domain, ranked by EWMA success rate.
	 * Returns null if no strategies have been recorded for this domain.
	 */
	getBestStrategy(url: string): StrategyScore | null {
		const hostname = this.extractHostname(url);
		const record = this.records.get(hostname);
		if (!record) return null;

		let best: StrategyScore | null = null;
		for (const score of Object.values(record.strategies)) {
			if (!best || score.ewmaSuccessRate > best.ewmaSuccessRate) best = score;
		}
		return best;
	}

	/**
	 * Return all recorded strategies for a domain, sorted by EWMA rate descending.
	 */
	getRankedStrategies(url: string): StrategyScore[] {
		const hostname = this.extractHostname(url);
		const record = this.records.get(hostname);
		if (!record) return [];

		return Object.values(record.strategies).sort((a, b) => b.ewmaSuccessRate - a.ewmaSuccessRate);
	}

	/**
	 * Return the full `DomainRecord` for a hostname.
	 * The hostname is extracted from `url` (eTLD+1).
	 */
	getDomainRecord(url: string): DomainRecord | null {
		return this.records.get(this.extractHostname(url)) ?? null;
	}

	/**
	 * Return all recorded domain hostnames.
	 */
	getKnownDomains(): string[] {
		return Array.from(this.records.keys());
	}

	/**
	 * Total number of distinct domains in memory.
	 */
	get domainCount(): number {
		return this.records.size;
	}

	// ─── Serialisation ──────────────────────────────────────────────────────────

	/**
	 * Export all records as a plain JSON-serialisable object.
	 * Store the result externally (profile data dir, agent state) to persist
	 * strategy memory across sessions.
	 */
	toJSON(): DomainMemorySnapshot {
		const domains: Record<string, DomainRecord> = {};
		for (const [k, v] of this.records) {
			domains[k] = { ...v, strategies: { ...v.strategies } };
		}
		return { version: 1, exportedAt: new Date().toISOString(), domains };
	}

	/**
	 * Import records from a previously exported snapshot.
	 * Merges into the current in-memory state (existing records are overwritten
	 * if the imported hostname already exists).
	 */
	fromJSON(snapshot: DomainMemorySnapshot): void {
		if (snapshot.version !== 1) return; // ignore unknown versions
		for (const [hostname, record] of Object.entries(snapshot.domains)) {
			this.records.set(hostname, { ...record });
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	/**
	 * Extract eTLD+1 from a URL. Falls back to full hostname if parsing fails.
	 * `https://www.reddit.com/r/all` → `reddit.com`
	 */
	extractHostname(url: string): string {
		try {
			const { hostname } = new URL(url);
			const parts = hostname.split(".");
			// eTLD+1: take last two parts (e.g. reddit.com from www.reddit.com)
			if (parts.length >= 2) {
				return parts.slice(-2).join(".");
			}
			return hostname;
		} catch { // NOSONAR -- non-fatal
			return url;
		}
	}
}
