/**
 * @file SkillLoader.ts
 * @description Loads SKILL.md files containing site-specific strategies that
 * can be injected into agent prompts for better domain-aware behaviour.
 *
 * Skills are discovered from configurable search paths (default: `./skills`
 * and `~/.talox/skills`). Each skill lives in its own directory and must
 * contain a `SKILL.md` file with YAML front-matter.
 *
 * @example
 * ```ts
 * const loader = new SkillLoader();
 * const count = await loader.loadAll();
 *
 * // Get formatted prompt content for a skill by name
 * const prompt = loader.toPrompt('slack-navigation');
 *
 * // Auto-match skills for a hostname
 * const hints = loader.toContextForDomain('app.slack.com');
 * ```
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SkillManifest {
	name: string;
	description: string;
	version: string;
	domain: string; // e.g. 'slack.com', 'github.com', 'generic-form'
	allowedTools?: string[];
	references?: Record<string, string>; // name -> file path
}

export interface LoadedSkill {
	manifest: SkillManifest;
	content: string; // Full SKILL.md content
	references: Map<string, string>; // name -> content
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SKILL_FILENAME = "SKILL.md";
const DEFAULT_SEARCH_PATHS = ["./skills", "~/.talox/skills"];
const FRONTMATTER_DELIMITER = "---";

// ─── SkillLoader ────────────────────────────────────────────────────────────

/**
 * Discovers, loads, and formats SKILL.md files for LLM prompt injection.
 */
export class SkillLoader {
	private readonly skills: Map<string, LoadedSkill> = new Map();
	private readonly searchPaths: string[];

	constructor(searchPaths?: string[]) {
		if (searchPaths && searchPaths.length > 0) {
			this.searchPaths = searchPaths;
		} else {
			this.searchPaths = DEFAULT_SEARCH_PATHS;
		}
	}

	// ─── Loading ──────────────────────────────────────────────────────────

	/**
	 * Scan all search paths and load every discoverable SKILL.md.
	 * Returns the number of skills successfully loaded.
	 */
	async loadAll(): Promise<number> {
		let loaded = 0;
		for (const rawPath of this.searchPaths) {
			const dir = this.resolvePath(rawPath);
			if (!existsSync(dir)) continue;
			if (!statSync(dir).isDirectory()) continue;

			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const skillFile = join(dir, entry.name, SKILL_FILENAME);
				const skill = await this.load(skillFile);
				if (skill) loaded++;
			}
		}
		return loaded;
	}

	/**
	 * Load a single SKILL.md file by its absolute path.
	 * Returns null if the file cannot be read or parsed.
	 */
	async load(path: string): Promise<LoadedSkill | null> {
		const resolved = this.resolvePath(path);
		if (!existsSync(resolved)) return null;

		let raw: string;
		try {
			raw = readFileSync(resolved, "utf-8");
		} catch {
			// NOSONAR — gracefully skip unreadable files
			return null;
		}

		const manifest = this.parseFrontmatter(raw);
		if (!manifest) return null;

		const references = await this.loadReferences(resolved, manifest);
		const skill: LoadedSkill = { manifest, content: raw, references };
		this.skills.set(manifest.name, skill);
		return skill;
	}

	// ─── Query ────────────────────────────────────────────────────────────

	/** Get a loaded skill by its manifest name. */
	get(name: string): LoadedSkill | undefined {
		return this.skills.get(name);
	}

	/** Return all loaded skills. */
	getAll(): LoadedSkill[] {
		return Array.from(this.skills.values());
	}

	/**
	 * Find all skills whose `domain` matches the given hostname.
	 * Supports exact match, suffix match, and wildcard patterns.
	 *
	 * Examples:
	 * - domain `slack.com` matches hostname `app.slack.com`
	 * - domain `*.slack.com` matches hostname `app.slack.com`
	 * - domain `slack.com` matches hostname `slack.com`
	 */
	matchDomain(hostname: string): LoadedSkill[] {
		const results: LoadedSkill[] = [];
		this.skills.forEach((skill) => {
			if (this.domainMatches(skill.manifest.domain, hostname)) {
				results.push(skill);
			}
		});
		return results;
	}

	// ─── Prompt Formatting ────────────────────────────────────────────────

	/**
	 * Format a skill for LLM prompt injection.
	 * Returns an empty string if the skill is not found.
	 */
	toPrompt(name: string): string {
		const skill = this.skills.get(name);
		if (!skill) return "";

		const parts: string[] = [
			`## Domain Skill: ${skill.manifest.name}`,
			`Domain: ${skill.manifest.domain}`,
			`Description: ${skill.manifest.description}`,
			`Version: ${skill.manifest.version}`,
		];

		if (skill.manifest.allowedTools && skill.manifest.allowedTools.length > 0) {
			parts.push(`Allowed Tools: ${skill.manifest.allowedTools.join(", ")}`);
		}

		// Strip frontmatter and add body content
		const body = this.stripFrontmatter(skill.content);
		if (body.trim()) {
			parts.push("", body.trim());
		}

		// Append any reference content
		skill.references.forEach((refContent, refName) => {
			parts.push("", `### Reference: ${refName}`, refContent.trim());
		});

		return parts.join("\n");
	}

	/**
	 * Auto-match skills for a hostname and return combined prompt content.
	 * Returns an empty string if no skills match.
	 */
	toContextForDomain(hostname: string): string {
		const matched = this.matchDomain(hostname);
		if (matched.length === 0) return "";

		const parts: string[] = [
			"# Domain-Specific Knowledge",
			"",
			"The following domain-specific skills are available for this site:",
			"",
		];

		for (const skill of matched) {
			parts.push(this.toPrompt(skill.manifest.name));
			parts.push("");
		}

		return parts.join("\n");
	}

	// ─── Private Helpers ──────────────────────────────────────────────────

	/**
	 * Parse YAML frontmatter from SKILL.md content.
	 * Returns null if frontmatter is missing or invalid.
	 */
	private parseFrontmatter(raw: string): SkillManifest | null {
		const trimmed = raw.trimStart();
		if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) return null;

		const endIdx = trimmed.indexOf(FRONTMATTER_DELIMITER, FRONTMATTER_DELIMITER.length);
		if (endIdx === -1) return null;

		const yamlBlock = trimmed.slice(FRONTMATTER_DELIMITER.length, endIdx);
		return this.parseYamlManifest(yamlBlock);
	}

	/**
	 * Minimal YAML parser for the skill manifest. Handles the flat key-value
	 * structure and simple arrays used in SKILL.md frontmatter.
	 */
	private parseYamlManifest(yaml: string): SkillManifest | null {
		const lines = yaml.split("\n");
		const values: Record<string, unknown> = {};
		let currentKey: string | null = null;
		let currentArray: string[] | null = null;

		for (const line of lines) {
			const trimmedLine = line.trim();
			if (trimmedLine === "" || trimmedLine.startsWith("#")) continue;

			// Array item: "- value"
			if (trimmedLine.startsWith("- ") && currentKey && currentArray) {
				currentArray.push(trimmedLine.slice(2).trim());
				continue;
			}

			// Flush any in-progress array
			if (currentKey && currentArray) {
				values[currentKey] = currentArray;
				currentKey = null;
				currentArray = null;
			}

			// Key-value pair: "key: value"
			const colonIdx = trimmedLine.indexOf(":");
			if (colonIdx === -1) continue;

			const key = trimmedLine.slice(0, colonIdx).trim();
			const val = trimmedLine.slice(colonIdx + 1).trim();

			if (val === "") {
				// Start of a YAML array block
				currentKey = key;
				currentArray = [];
			} else {
				values[key] = this.parseScalar(val);
			}
		}

		// Flush final array if any
		if (currentKey && currentArray) {
			values[currentKey] = currentArray;
		}

		// Validate required fields
		if (!values.name || !values.description || !values.version || !values.domain) {
			return null;
		}

		const manifest: SkillManifest = {
			name: String(values.name),
			description: String(values.description),
			version: String(values.version),
			domain: String(values.domain),
		};

		if (Array.isArray(values.allowedTools)) {
			manifest.allowedTools = values.allowedTools as string[];
		}
		if (values.references && typeof values.references === "object") {
			manifest.references = values.references as Record<string, string>;
		}

		return manifest;
	}

	/** Parse a scalar YAML value (string, number, boolean). */
	private parseScalar(val: string): unknown {
		if (val === "true") return true;
		if (val === "false") return false;
		if (/^-?\d+$/.test(val)) return Number.parseInt(val, 10);
		if (/^-?\d+\.\d+$/.test(val)) return Number.parseFloat(val);
		// Strip surrounding quotes
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			return val.slice(1, -1);
		}
		return val;
	}

	/** Strip the frontmatter block from markdown content, returning only the body. */
	private stripFrontmatter(raw: string): string {
		const trimmed = raw.trimStart();
		if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) return raw;

		const endIdx = trimmed.indexOf(FRONTMATTER_DELIMITER, FRONTMATTER_DELIMITER.length);
		if (endIdx === -1) return raw;

		return trimmed.slice(endIdx + FRONTMATTER_DELIMITER.length);
	}

	/**
	 * Load reference files declared in the manifest.
	 * Reference paths are relative to the SKILL.md file's parent directory.
	 */
	private async loadReferences(
		skillPath: string,
		manifest: SkillManifest,
	): Promise<Map<string, string>> {
		const refs = new Map<string, string>();
		if (!manifest.references) return refs;

		const skillDir = resolve(skillPath, "..");

		for (const [name, relativePath] of Object.entries(manifest.references)) {
			const absPath = resolve(skillDir, relativePath);
			try {
				if (existsSync(absPath)) {
					refs.set(name, readFileSync(absPath, "utf-8"));
				}
			} catch {
				// NOSONAR — skip unreadable references
			}
		}

		return refs;
	}

	/**
	 * Check if a skill domain pattern matches a given hostname.
	 */
	private domainMatches(domain: string, hostname: string): boolean {
		const d = domain.toLowerCase();
		const h = hostname.toLowerCase();

		// Exact match
		if (d === h) return true;

		// Wildcard: *.example.com matches sub.example.com
		if (d.startsWith("*.")) {
			const suffix = d.slice(2);
			return h === suffix || h.endsWith("." + suffix);
		}

		// Suffix match: slack.com matches app.slack.com
		return h.endsWith("." + d);
	}

	/**
	 * Resolve a path string, expanding `~` to the user's home directory.
	 */
	private resolvePath(rawPath: string): string {
		if (rawPath.startsWith("~" + sep) || rawPath === "~") {
			return join(homedir(), rawPath.slice(1));
		}
		return resolve(rawPath);
	}
}
