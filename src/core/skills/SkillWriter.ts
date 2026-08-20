/**
 * @file SkillWriter.ts
 * @description Creates and writes SKILL.md files to disk from structured
 * DynamicSkill data, then reloads them via SkillLoader for immediate use.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DynamicSkill } from "../loop/types.js";
import type { SkillLoader } from "./SkillLoader.js";

// ─── SkillWriter ────────────────────────────────────────────────────────────

/**
 * Writes DynamicSkill objects to disk as SKILL.md files and reloads them
 * through the SkillLoader so they are immediately available.
 */
export class SkillWriter {
	private readonly skillsDir: string;
	private readonly loader: SkillLoader;

	constructor(skillsDir: string, loader: SkillLoader) {
		this.skillsDir = skillsDir;
		this.loader = loader;
	}

	// ─── Public API ──────────────────────────────────────────────────────

	/**
	 * Create a new skill from structured content.
	 * Writes the SKILL.md file to disk and reloads it via the loader.
	 * Returns the file path of the created skill.
	 */
	async createSkill(skill: DynamicSkill): Promise<string> {
		const dir = join(this.skillsDir, skill.domain);
		await mkdir(dir, { recursive: true });

		const content = this.formatSkillFile(skill);
		const filePath = join(dir, "SKILL.md");

		await writeFile(filePath, content, "utf-8");
		await this.loader.load(filePath);

		return filePath;
	}

	/**
	 * Validate a skill works by checking it was loaded correctly.
	 * Returns true if the skill has both a name and description in its manifest.
	 */
	async validateSkill(name: string): Promise<boolean> {
		const loaded = this.loader.get(name);
		return loaded !== undefined && !!loaded.manifest.name && !!loaded.manifest.description;
	}

	/**
	 * Format a DynamicSkill into SKILL.md format with YAML frontmatter.
	 */
	formatSkillFile(skill: DynamicSkill): string {
		const lines: string[] = [
			"---",
			`name: ${skill.name}`,
			`description: ${skill.description}`,
			`domain: ${skill.domain}`,
			`version: "${skill.version}"`,
			`trigger: ${skill.triggerCondition}`,
		];

		if (skill.toolUsage.length > 0) {
			lines.push("allowedTools:");
			for (const tool of skill.toolUsage) {
				lines.push(`  - ${tool}`);
			}
		}

		lines.push("---", "", skill.content);

		return lines.join("\n");
	}
}
