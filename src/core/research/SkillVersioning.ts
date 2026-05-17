/**
 * @file SkillVersioning.ts
 * @description Version control for skills — tracks changes over time,
 * supports rollback to previous versions, and prunes old versions.
 *
 * Each skill version is stored with its associated RunMetrics so we can
 * always identify which version performed best.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunMetrics, SkillVersion } from "./types.js";

// ─── SkillVersioning ──────────────────────────────────────────────────────

export class SkillVersioning {
	private readonly persistDir: string;
	private readonly maxVersions: number;
	private readonly cache = new Map<string, SkillVersion[]>();

	constructor(persistDir: string, maxVersions = 10) {
		this.persistDir = persistDir;
		this.maxVersions = maxVersions;
	}

	/**
	 * Initialize the versioning directory.
	 */
	async initialize(): Promise<void> {
		await mkdir(this.persistDir, { recursive: true });
		await this.loadAll();
	}

	/**
	 * Commit a new version of a skill.
	 * Returns the version string.
	 */
	async commit(skillName: string, content: string, metrics?: RunMetrics): Promise<string> {
		const versions = await this.getVersions(skillName);

		// Mark all existing versions as non-current
		for (const v of versions) {
			v.isCurrent = false;
		}

		const versionNum = versions.length + 1;
		const version: SkillVersion = {
			skillName,
			version: `v${versionNum}`,
			content,
			createdAt: new Date().toISOString(),
			metrics: metrics ?? null,
			isCurrent: true,
		};

		versions.push(version);
		await this.pruneOldVersions(skillName, versions);
		await this.saveVersions(skillName, versions);

		return version.version;
	}

	/**
	 * Get the current (latest) version of a skill.
	 */
	async getCurrent(skillName: string): Promise<SkillVersion | null> {
		const versions = await this.getVersions(skillName);
		return versions.find((v) => v.isCurrent) ?? versions[versions.length - 1] ?? null;
	}

	/**
	 * Get all versions of a skill, oldest first.
	 */
	async getVersions(skillName: string): Promise<SkillVersion[]> {
		const cached = this.cache.get(skillName);
		if (cached) return cached;

		const versions = await this.loadVersions(skillName);
		this.cache.set(skillName, versions);
		return versions;
	}

	/**
	 * Roll back to a specific version. The rolled-back version becomes current.
	 */
	async rollback(skillName: string, targetVersion: string): Promise<SkillVersion | null> {
		const versions = await this.getVersions(skillName);
		const target = versions.find((v) => v.version === targetVersion);
		if (!target) return null;

		// Mark all as non-current, then mark target as current
		for (const v of versions) {
			v.isCurrent = v.version === targetVersion;
		}

		await this.saveVersions(skillName, versions);
		return target;
	}

	/**
	 * Roll back to the best-performing version (highest fitness score).
	 */
	async rollbackToBest(skillName: string): Promise<SkillVersion | null> {
		const versions = await this.getVersions(skillName);
		const withMetrics = versions.filter((v) => v.metrics !== null);
		if (withMetrics.length === 0) return null;

		// Best = highest goal achievement rate, then lowest iterations
		withMetrics.sort((a, b) => {
			const aScore = (a.metrics!.goalAchieved ? 1000 : 0) - a.metrics!.iterationsToGoal;
			const bScore = (b.metrics!.goalAchieved ? 1000 : 0) - b.metrics!.iterationsToGoal;
			return bScore - aScore;
		});

		const best = withMetrics[0]; if (!best) throw new Error(`No metrics found for skill ${skillName}`);
		return this.rollback(skillName, best.version);
	}

	/**
	 * Get version count for a skill.
	 */
	async getVersionCount(skillName: string): Promise<number> {
		const versions = await this.getVersions(skillName);
		return versions.length;
	}

	/**
	 * Delete all versions of a skill.
	 */
	async deleteAllVersions(skillName: string): Promise<void> {
		this.cache.delete(skillName);
		const path = this.versionFilePath(skillName);
		try {
			await unlink(path);
		} catch {
			// File doesn't exist — fine
		}
	}

	// ─── Private ───────────────────────────────────────────────────────────

	private async pruneOldVersions(skillName: string, versions: SkillVersion[]): Promise<void> {
		while (versions.length > this.maxVersions) {
			// Remove the oldest non-current version
			const removableIdx = versions.findIndex((v) => !v.isCurrent);
			if (removableIdx === -1) break;
			versions.splice(removableIdx, 1);
		}
	}

	private async loadAll(): Promise<void> {
		try {
			const files = await readdir(this.persistDir);
			for (const file of files) {
				if (file.endsWith(".json")) {
					const skillName = file.replace(".json", "");
					const versions = await this.loadVersions(skillName);
					this.cache.set(skillName, versions);
				}
			}
		} catch {
			// Directory doesn't exist yet
		}
	}

	private async loadVersions(skillName: string): Promise<SkillVersion[]> {
		try {
			const path = this.versionFilePath(skillName);
			const raw = await readFile(path, "utf-8");
			return JSON.parse(raw) as SkillVersion[];
		} catch {
			return [];
		}
	}

	private async saveVersions(skillName: string, versions: SkillVersion[]): Promise<void> {
		this.cache.set(skillName, versions);
		const path = this.versionFilePath(skillName);
		await writeFile(path, JSON.stringify(versions, null, 2), "utf-8");
	}

	private versionFilePath(skillName: string): string {
		// Sanitize skillName for filesystem
		const safe = skillName.replace(/[^a-zA-Z0-9_-]/g, "_");
		return join(this.persistDir, `${safe}.json`);
	}
}
