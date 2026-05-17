/**
 * @file PromptEvolver.ts
 * @description Self-prompting planner evolution — mutates and selects system
 * prompts that produce better autonomous loop performance.
 *
 * Uses a genetic programming approach: prompts are "chromosomes" that get
 * mutated (single-segment changes), crossed over (segment swaps), and
 * selected based on fitness (task completion metrics).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResearchJournal } from "./ResearchJournal.js";
import type { PromptVariant, RunMetrics } from "./types.js";

// ─── Prompt Segments ──────────────────────────────────────────────────────

const PROMPT_SEGMENTS = [
	"You are an autonomous web browsing agent. Complete the task efficiently.",
	"Prioritize speed — minimize unnecessary page loads and waits.",
	"Be stealthy — mimic human browsing patterns with natural delays.",
	"On errors, retry with exponential backoff. Never give up early.",
	"Analyze the page structure before interacting. Read before clicking.",
	"When blocked by CAPTCHAs or login walls, try alternative approaches.",
	"Use keyboard shortcuts when available — they're faster than clicking.",
	"Break complex tasks into smaller sub-tasks and verify each step.",
	"If a selector fails, inspect the DOM for alternatives before giving up.",
	"Track your progress — don't repeat actions you've already completed.",
] as const;

const MUTATION_OPERATIONS = ["swap_segment", "insert_segment", "remove_segment", "reorder_segments"] as const;

// ─── PromptEvolver ────────────────────────────────────────────────────────

export class PromptEvolver {
	private readonly journal: ResearchJournal;
	private readonly persistDir: string;
	private readonly maxGenerations = 10;
	private readonly populationSize = 5;
	private population: PromptVariant[] = [];
	private generation = 0;

	constructor(journal: ResearchJournal, persistDir: string) {
		this.journal = journal;
		this.persistDir = persistDir;
	}

	/**
	 * Initialize the population with the seed prompt.
	 */
	async initialize(seedPrompt: string): Promise<void> {
		await mkdir(this.persistDir, { recursive: true });

		// Try to load existing population from disk
		const loaded = await this.loadPopulation();
		if (loaded.length > 0) {
			this.population = loaded;
			this.generation = Math.max(...loaded.map((v) => v.generation));
			return;
		}

		// Create initial population from seed + mutations
		const seed: PromptVariant = {
			id: this.nextId(),
			systemPrompt: seedPrompt,
			parentId: null,
			generation: 0,
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};

		this.population = [seed];
		for (let i = 1; i < this.populationSize; i++) {
			this.population.push(this.mutate(seed));
		}

		await this.savePopulation();
	}

	/**
	 * Get the current best prompt.
	 */
	getBestPrompt(): PromptVariant | null {
		if (this.population.length === 0) return null;
		const sorted = [...this.population].sort((a, b) => b.fitnessScore - a.fitnessScore); return sorted[0] ?? null;
	}

	/**
	 * Get a prompt variant by index (for round-robin testing).
	 */
	getVariant(index: number): PromptVariant | null {
		return this.population[index % this.population.length] ?? null;
	}

	/**
	 * Record fitness score for a variant and evolve if all variants are scored.
	 */
	async recordFitness(variantId: string, metrics: RunMetrics): Promise<void> {
		const variant = this.population.find((v) => v.id === variantId);
		if (!variant) return;

		// Fitness function: higher is better
		// Goal achievement is paramount, then speed, then cost
		variant.fitnessScore = this.computeFitness(metrics);

		// Check if all variants in current generation have been scored
		const allScored = this.population.every((v) => v.fitnessScore > 0);
		if (allScored && this.generation < this.maxGenerations) {
			await this.evolve();
		}

		await this.savePopulation();
	}

	/**
	 * Evolve to the next generation using selection + mutation.
	 */
	private async evolve(): Promise<void> {
		this.generation++;

		// Selection: keep top 2 (elitism)
		const sorted = [...this.population].sort((a, b) => b.fitnessScore - a.fitnessScore);
		const elites = sorted.slice(0, 2);

		// Generate new variants by mutating elites
		const newPopulation: PromptVariant[] = [...elites];

		// Fill remaining slots with mutations of the best
		while (newPopulation.length < this.populationSize) {
			const parent = elites[Math.floor(Math.random() * elites.length)]; if (!parent) continue;
			newPopulation.push(this.mutate(parent));
		}

		this.population = newPopulation;
	}

	/**
	 * Mutate a prompt variant to create a new offspring.
	 */
	private mutate(parent: PromptVariant): PromptVariant {
		const operation = MUTATION_OPERATIONS[Math.floor(Math.random() * MUTATION_OPERATIONS.length)] ?? MUTATION_OPERATIONS[0];
		let prompt = parent.systemPrompt;

		switch (operation) {
			case "swap_segment": {
				// Replace a random segment with a different one
				const idx = Math.floor(Math.random() * PROMPT_SEGMENTS.length);
				const replacement = PROMPT_SEGMENTS[idx]; if (!replacement) break;
				const lines = prompt.split("\n").filter(Boolean);
				if (lines.length > 0) {
					const targetLine = Math.floor(Math.random() * lines.length);
					lines[targetLine] = replacement;
				} else {
					lines.push(replacement);
				}
				prompt = lines.join("\n");
				break;
			}
			case "insert_segment": {
				const seg = PROMPT_SEGMENTS[Math.floor(Math.random() * PROMPT_SEGMENTS.length)]; if (!seg) break;
				const lines = prompt.split("\n").filter(Boolean);
				const insertAt = Math.floor(Math.random() * (lines.length + 1));
				lines.splice(insertAt, 0, seg);
				prompt = lines.join("\n");
				break;
			}
			case "remove_segment": {
				const lines = prompt.split("\n").filter(Boolean);
				if (lines.length > 2) {
					lines.splice(Math.floor(Math.random() * lines.length), 1);
				}
				prompt = lines.join("\n");
				break;
			}
			case "reorder_segments": {
				const lines = prompt.split("\n").filter(Boolean);
				// Fisher-Yates shuffle of a subset
				const start = Math.floor(Math.random() * Math.max(1, lines.length - 2));
				const end = Math.min(lines.length, start + 3);
				for (let i = end - 1; i > start; i--) {
					const j = start + Math.floor(Math.random() * (i - start + 1));
					[lines[i], lines[j]] = [lines[j]!, lines[i]!];
				}
				prompt = lines.join("\n");
				break;
			}
		}

		return {
			id: this.nextId(),
			systemPrompt: prompt,
			parentId: parent.id,
			generation: this.generation,
			fitnessScore: 0,
			createdAt: new Date().toISOString(),
		};
	}

	/**
	 * Compute fitness from run metrics.
	 */
	private computeFitness(metrics: RunMetrics): number {
		let fitness = 0;

		// Goal achievement is the most important factor
		fitness += metrics.goalAchieved ? 50 : 0;

		// Speed: fewer iterations = higher fitness
		fitness += Math.max(0, 20 - metrics.iterationsToGoal);

		// Cost efficiency
		fitness += Math.max(0, 10 - metrics.totalCostUsd * 100);

		// Reliability: fewer blockers = higher fitness
		fitness += Math.max(0, 10 - metrics.blockerCount * 2);

		// Strategy success rate contribution
		fitness += metrics.strategySuccessRate * 10;

		return Math.max(0, fitness);
	}

	// ─── Persistence ───────────────────────────────────────────────────────

	private async savePopulation(): Promise<void> {
		const path = join(this.persistDir, "prompt-population.json");
		await writeFile(path, JSON.stringify(this.population, null, 2), "utf-8");
	}

	private async loadPopulation(): Promise<PromptVariant[]> {
		try {
			const path = join(this.persistDir, "prompt-population.json");
			const raw = await readFile(path, "utf-8");
			return JSON.parse(raw) as PromptVariant[];
		} catch {
			return [];
		}
	}

	private nextId(): string {
		return `pv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}
}
