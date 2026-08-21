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

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { FAILSAFE_SCHEMA, load as loadYaml } from "js-yaml";

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

interface LoadedSkillFile {
	skill: LoadedSkill;
	sourcePath: string;
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
	private readonly skillSources: Map<string, string> = new Map();
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
	 * Scan all configured search paths and reconcile the managed registry with
	 * the filesystem. Explicitly loaded skills outside those roots are preserved.
	 * The registry is swapped only after the scan completes successfully.
	 * Returns the number of discoverable managed skills successfully loaded.
	 */
	async loadAll(): Promise<number> {
		const managedRoots = this.searchPaths.map((rawPath) => this.resolvePath(rawPath));
		const nextSkills = new Map<string, LoadedSkill>();
		const nextSources = new Map<string, string>();

		// Preserve explicitly loaded skills that live outside configured search roots.
		for (const [name, skill] of this.skills) {
			const sourcePath = this.skillSources.get(name);
			if (!sourcePath || !managedRoots.some((root) => this.isPathWithinRoot(sourcePath, root))) {
				nextSkills.set(name, skill);
				if (sourcePath) nextSources.set(name, sourcePath);
			}
		}

		let loaded = 0;
		for (const dir of managedRoots) {
			if (!existsSync(dir)) continue;
			if (!statSync(dir).isDirectory()) continue;

			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const loadedFile = await this.readSkillFile(join(dir, entry.name, SKILL_FILENAME));
				if (!loadedFile) continue;

				nextSkills.set(loadedFile.skill.manifest.name, loadedFile.skill);
				nextSources.set(loadedFile.skill.manifest.name, loadedFile.sourcePath);
				loaded++;
			}
		}

		this.skills.clear();
		this.skillSources.clear();
		for (const [name, skill] of nextSkills) this.skills.set(name, skill);
		for (const [name, sourcePath] of nextSources) this.skillSources.set(name, sourcePath);

		return loaded;
	}

	/**
	 * Load a single SKILL.md file by its absolute path.
	 * Returns null if the file cannot be read or parsed.
	 */
	async load(path: string): Promise<LoadedSkill | null> {
		const loadedFile = await this.readSkillFile(path);
		if (!loadedFile) return null;

		this.skills.set(loadedFile.skill.manifest.name, loadedFile.skill);
		this.skillSources.set(loadedFile.skill.manifest.name, loadedFile.sourcePath);
		return loadedFile.skill;
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

	private async readSkillFile(path: string): Promise<LoadedSkillFile | null> {
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
		return {
			skill: { manifest, content: raw, references },
			sourcePath: resolved,
		};
	}

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
	 * Parse skill frontmatter with the YAML parser Talox already ships.
	 * FAILSAFE_SCHEMA keeps scalar identifiers such as `version: 1.0` as strings
	 * while still supporting arrays and nested mappings such as `references`.
	 */
	private parseYamlManifest(yaml: string): SkillManifest | null {
		try {
			const parsed = loadYaml(yaml, { schema: FAILSAFE_SCHEMA });
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
			return this.buildManifest(parsed as Record<string, unknown>);
		} catch {
			return null;
		}
	}

	/** Validate parsed values and build a SkillManifest, or return null. */
	private buildManifest(values: Record<string, unknown>): SkillManifest | null {
		if (
			typeof values.name !== "string" ||
			typeof values.description !== "string" ||
			typeof values.version !== "string" ||
			typeof values.domain !== "string"
		) {
			return null;
		}

		const manifest: SkillManifest = {
			name: values.name,
			description: values.description,
			version: values.version,
			domain: values.domain,
		};

		if (Array.isArray(values.allowedTools)) {
			const allowedTools = values.allowedTools.filter((tool): tool is string => typeof tool === "string");
			if (allowedTools.length > 0) manifest.allowedTools = allowedTools;
		}
		if (values.references && typeof values.references === "object" && !Array.isArray(values.references)) {
			const references: Record<string, string> = {};
			for (const [name, referencePath] of Object.entries(values.references as Record<string, unknown>)) {
				if (typeof referencePath === "string") references[name] = referencePath;
			}
			if (Object.keys(references).length > 0) manifest.references = references;
		}

		return manifest;
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
	 * References are sandboxed to the skill directory after canonical path
	 * resolution so `..`, absolute paths, and symlinks cannot escape it.
	 */
	private async loadReferences(skillPath: string, manifest: SkillManifest): Promise<Map<string, string>> {
		const refs = new Map<string, string>();
		if (!manifest.references) return refs;

		const skillDir = resolve(skillPath, "..");
		const canonicalSkillDir = await this.canonicalizeExistingPath(skillDir);
		if (!canonicalSkillDir) return refs;

		for (const [name, referencePath] of Object.entries(manifest.references)) {
			try {
				const canonicalReference = await this.canonicalizeExistingPath(resolve(skillDir, referencePath));
				if (!canonicalReference || !this.isPathWithinRoot(canonicalReference, canonicalSkillDir)) continue;
				refs.set(name, readFileSync(canonicalReference, "utf-8"));
			} catch {
				// NOSONAR — skip missing, unreadable, or escaping references
			}
		}

		return refs;
	}

	/**
	 * Resolve an existing path to its canonical filesystem target. Real Node
	 * always exposes realpathSync; the resolved fallback supports intentionally
	 * incomplete node:fs test doubles that omit that built-in export.
	 */
	private async canonicalizeExistingPath(path: string): Promise<string | null> {
		try {
			const fs = await import("node:fs");
			if (typeof fs.realpathSync === "function") return fs.realpathSync(path);
			return existsSync(path) ? resolve(path) : null;
		} catch {
			return null;
		}
	}

	/** Check whether a source path lives inside a configured search root. */
	private isPathWithinRoot(sourcePath: string, root: string): boolean {
		const rel = relative(root, sourcePath);
		return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
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
			return h === suffix || h.endsWith(`.${suffix}`);
		}

		// Suffix match: slack.com matches app.slack.com
		return h.endsWith(`.${d}`);
	}

	/**
	 * Resolve a path string, expanding `~` to the user's home directory.
	 */
	private resolvePath(rawPath: string): string {
		if (rawPath.startsWith(`~${sep}`) || rawPath === "~") {
			return join(homedir(), rawPath.slice(1));
		}
		return resolve(rawPath);
	}
}
