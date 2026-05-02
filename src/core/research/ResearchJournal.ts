/**
 * @file ResearchJournal.ts
 * @description Persistent append-only journal for all research outcomes.
 * Stores experiment runs, skill evaluations, strategy promotions, and
 * cross-domain transfers. Supports disk persistence via JSONL.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	JournalEntry,
	ExperimentRun,
	SkillEvaluation,
	StrategyPromotion,
	Hypothesis,
	ComposedStrategy,
	TransferRecord,
	DomainResearchSummary,
	ResearchJournalSnapshot,
	RunMetrics,
} from "./types.js";

// ─── ResearchJournal ─────────────────────────────────────────────────────────

export class ResearchJournal {
	private readonly entries: JournalEntry[] = [];
	private readonly domainSummaries = new Map<string, DomainResearchSummary>();
	private readonly persistPath: string | null;
	private dirty = false;

	constructor(options: { persistPath?: string } = {}) {
		this.persistPath = options.persistPath ?? null;
	}

	// ─── Append ────────────────────────────────────────────────────────────

	/** Record an experiment run and update domain summaries. */
	recordExperimentRun(run: ExperimentRun): void {
		this.append({
			id: this.nextId(),
			type: "experiment_run",
			timestamp: new Date().toISOString(),
			data: run,
		});
		this.updateDomainSummary(run.domain, run.metrics);
	}

	/** Record a skill evaluation outcome. */
	recordSkillEvaluation(evaluation: SkillEvaluation): void {
		this.append({
			id: this.nextId(),
			type: "skill_evaluated",
			timestamp: new Date().toISOString(),
			data: evaluation,
		});
	}

	/** Record a strategy promotion. */
	recordStrategyPromotion(promotion: StrategyPromotion): void {
		this.append({
			id: this.nextId(),
			type: "strategy_promoted",
			timestamp: new Date().toISOString(),
			data: promotion,
		});
		const summary = this.domainSummaries.get(promotion.domain);
		if (summary) {
			summary.bestStrategy = promotion.strategyName;
		}
	}

	/** Record a hypothesis generation. */
	recordHypothesis(hypothesis: Hypothesis): void {
		this.append({
			id: this.nextId(),
			type: "hypothesis_generated",
			timestamp: new Date().toISOString(),
			data: hypothesis,
		});
	}

	/** Record a skill creation event. */
	recordSkillCreated(run: ExperimentRun): void {
		this.append({
			id: this.nextId(),
			type: "skill_created",
			timestamp: new Date().toISOString(),
			data: run,
		});
	}

	/** Record a cross-domain transfer attempt. */
	recordTransfer(record: TransferRecord): void {
		this.append({
			id: this.nextId(),
			type: "cross_domain_transfer",
			timestamp: new Date().toISOString(),
			data: record,
		});
	}

	/** Record a strategy composition. */
	recordComposition(composition: ComposedStrategy): void {
		this.append({
			id: this.nextId(),
			type: "strategy_composed",
			timestamp: new Date().toISOString(),
			data: composition,
		});
	}

	// ─── Query ─────────────────────────────────────────────────────────────

	/** Get all entries, optionally filtered by type. */
	getEntries(type?: JournalEntry["type"]): JournalEntry[] {
		if (!type) return [...this.entries];
		return this.entries.filter((e) => e.type === type);
	}

	/** Get the most recent N experiment runs for a domain. */
	getRecentRuns(domain: string, limit = 10): ExperimentRun[] {
		return this.entries
			.filter((e) => e.type === "experiment_run" && (e.data as ExperimentRun).domain === domain)
			.map((e) => e.data as ExperimentRun)
			.slice(-limit);
	}

	/** Get all experiment runs for a specific experiment ID. */
	getExperimentRuns(experimentId: string): ExperimentRun[] {
		return this.entries
			.filter((e) => e.type === "experiment_run" && (e.data as ExperimentRun).experimentId === experimentId)
			.map((e) => e.data as ExperimentRun);
	}

	/** Get domain summary. */
	getDomainSummary(domain: string): DomainResearchSummary | null {
		return this.domainSummaries.get(domain) ?? null;
	}

	/** Get all known domains. */
	getKnownDomains(): string[] {
		return Array.from(this.domainSummaries.keys());
	}

	/** Get total entry count. */
	get size(): number {
		return this.entries.length;
	}

	// ─── Persistence ───────────────────────────────────────────────────────

	/** Load journal from disk. Replaces current in-memory state. */
	async load(): Promise<void> {
		if (!this.persistPath) return;
		try {
			const raw = await readFile(this.persistPath, "utf-8");
			const lines = raw.trim().split("\n").filter(Boolean);
			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as JournalEntry;
					this.entries.push(entry);
					// Rebuild domain summaries from experiment runs
					if (entry.type === "experiment_run") {
						const run = entry.data as ExperimentRun;
						this.updateDomainSummary(run.domain, run.metrics);
					}
				} catch {
					// Skip malformed lines
				}
			}
		} catch {
			// File doesn't exist yet — that's fine
		}
	}

	/** Flush dirty entries to disk (append mode). */
	async flush(): Promise<void> {
		if (!this.dirty || !this.persistPath) return;
		const dir = join(this.persistPath, "..");
		await mkdir(dir, { recursive: true });
		// Append only the entries that haven't been flushed
		const lines = this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
		await writeFile(this.persistPath, lines, "utf-8");
		this.dirty = false;
	}

	/** Export full journal as a snapshot. */
	toSnapshot(): ResearchJournalSnapshot {
		const domains: Record<string, DomainResearchSummary> = {};
		for (const [k, v] of this.domainSummaries) {
			domains[k] = { ...v };
		}
		return {
			version: 1 as const,
			exportedAt: new Date().toISOString(),
			entries: [...this.entries],
			domains,
		};
	}

	// ─── Private ───────────────────────────────────────────────────────────

	private append(entry: JournalEntry): void {
		this.entries.push(entry);
		this.dirty = true;
	}

	private updateDomainSummary(domain: string, metrics: RunMetrics): void {
		let summary = this.domainSummaries.get(domain);
		if (!summary) {
			summary = {
				domain,
				totalRuns: 0,
				successRate: 0,
				bestStrategy: null,
				knownSkills: [],
				avgIterationsToGoal: 0,
			};
			this.domainSummaries.set(domain, summary);
		}

		const totalSuccesses = metrics.goalAchieved ? 1 : 0;
		summary.totalRuns++;
		summary.successRate =
			(summary.successRate * (summary.totalRuns - 1) + totalSuccesses) / summary.totalRuns;
		summary.avgIterationsToGoal =
			(summary.avgIterationsToGoal * (summary.totalRuns - 1) + metrics.iterationsToGoal) /
			summary.totalRuns;
	}

	private nextId(): string {
		return `je_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}
}
