import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSkill } from "../../src/core/skills/SkillLoader";

// ─── Helpers ────────────────────────────────────────────────────────────────

// vi.mock() factories are hoisted above imports, so we use vi.hoisted()
// to ensure these constants are available when the factory runs.
const fsMocks = vi.hoisted(() => {
	const VALID = `---
name: slack-navigation
description: Navigation strategies for Slack web app
version: "1.0"
domain: slack.com
allowedTools:
  - click
  - type
  - getState
---

## Slack Navigation Tips

- Use the sidebar to switch channels
- Use Ctrl+K to open the quick switcher
`;

	const WILDCARD = `---
name: github-wildcard
description: GitHub wildcard skill
version: "1.0"
domain: "*.github.com"
---

## GitHub Tips
`;

	const INVALID = `This file has no frontmatter at all.
Just some plain text.
`;

	const INCOMPLETE = `---
name: incomplete-skill
---
Missing required fields.
`;

	const exists = vi.fn().mockReturnValue(true);
	const read = vi.fn().mockReturnValue(VALID);
	const stat = vi.fn().mockReturnValue({ isDirectory: () => true });
	const readdir = vi.fn().mockReturnValue([]);
	const realpath = vi.fn().mockImplementation((p: string) => {
		if (!exists(p)) {
			const err = new Error(`ENOENT: no such file or directory, realpath '${p}'`);
			(err as any).code = "ENOENT";
			throw err;
		}
		return p;
	});

	return {
		VALID_SKILL_MD: VALID,
		WILDCARD_SKILL_MD: WILDCARD,
		INVALID_SKILL_MD: INVALID,
		INCOMPLETE_SKILL_MD: INCOMPLETE,
		readFileSync: read,
		existsSync: exists,
		statSync: stat,
		readdirSync: readdir,
		realpathSync: realpath,
	};
});

const { VALID_SKILL_MD, WILDCARD_SKILL_MD, INVALID_SKILL_MD, INCOMPLETE_SKILL_MD } = fsMocks;

const MINIMAL_SKILL_MD = `---
name: minimal
description: A minimal skill
version: "0.1"
domain: example.com
---

Minimal content.
`;

vi.mock("node:fs", () => ({
	readFileSync: fsMocks.readFileSync,
	existsSync: fsMocks.existsSync,
	statSync: fsMocks.statSync,
	readdirSync: fsMocks.readdirSync,
	realpathSync: fsMocks.realpathSync,
}));

// Re-import SkillLoader dynamically where needed (top-level import works for basic tests)
import { SkillLoader } from "../../src/core/skills/SkillLoader";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SkillLoader", () => {
	describe("constructor", () => {
		it("uses default search paths when none provided", () => {
			const loader = new SkillLoader();
			// We can't inspect private fields directly, but loadAll on
			// non-existent dirs returns 0
			expect(loader.getAll()).toEqual([]);
		});

		it("uses provided search paths", () => {
			const loader = new SkillLoader(["/nonexistent"]);
			expect(loader.getAll()).toEqual([]);
		});
	});

	describe("load (YAML frontmatter parsing)", () => {
		it("parses a valid SKILL.md file", async () => {
			// Need to re-import with mock
			const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
			const loader = new SL();
			const skill = await loader.load("/skills/slack/SKILL.md");

			expect(skill).not.toBeNull();
			expect(skill!.manifest.name).toBe("slack-navigation");
			expect(skill!.manifest.description).toBe("Navigation strategies for Slack web app");
			expect(skill!.manifest.version).toBe("1.0");
			expect(skill!.manifest.domain).toBe("slack.com");
			expect(skill!.manifest.allowedTools).toEqual(["click", "type", "getState"]);
		});

		it("returns null for non-existent file", async () => {
			const { existsSync } = await import("node:fs");
			vi.mocked(existsSync as any).mockReturnValue(false);

			const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
			const loader = new SL();
			const skill = await loader.load("/nonexistent/SKILL.md");
			expect(skill).toBeNull();
		});

		it("returns null for file without frontmatter", async () => {
			const { readFileSync, existsSync } = await import("node:fs");
			vi.mocked(existsSync as any).mockReturnValue(true);
			vi.mocked(readFileSync as any).mockReturnValue(INVALID_SKILL_MD);

			const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
			const loader = new SL();
			const skill = await loader.load("/skills/invalid/SKILL.md");
			expect(skill).toBeNull();
		});

		it("returns null for incomplete frontmatter (missing required fields)", async () => {
			const { readFileSync, existsSync } = await import("node:fs");
			vi.mocked(existsSync as any).mockReturnValue(true);
			vi.mocked(readFileSync as any).mockReturnValue(INCOMPLETE_SKILL_MD);

			const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
			const loader = new SL();
			const skill = await loader.load("/skills/incomplete/SKILL.md");
			expect(skill).toBeNull();
		});
	});

	describe("domain matching", () => {
		let loader: SkillLoader;

		beforeEach(() => {
			loader = new SkillLoader();
			// Manually inject skills into the loader
			(loader as any).skills.set("slack-navigation", {
				manifest: {
					name: "slack-navigation",
					description: "Slack nav",
					version: "1.0",
					domain: "slack.com",
				},
				content: VALID_SKILL_MD,
				references: new Map(),
			});
			(loader as any).skills.set("github-wildcard", {
				manifest: {
					name: "github-wildcard",
					description: "GitHub tips",
					version: "1.0",
					domain: "*.github.com",
				},
				content: WILDCARD_SKILL_MD,
				references: new Map(),
			});
			(loader as any).skills.set("exact-match", {
				manifest: {
					name: "exact-match",
					description: "Exact match only",
					version: "1.0",
					domain: "app.example.com",
				},
				content: MINIMAL_SKILL_MD,
				references: new Map(),
			});
		});

		it("matches exact domain", () => {
			const matches = loader.matchDomain("slack.com");
			expect(matches).toHaveLength(1);
			expect(matches[0]!.manifest.name).toBe("slack-navigation");
		});

		it("matches subdomain via suffix (slack.com matches app.slack.com)", () => {
			const matches = loader.matchDomain("app.slack.com");
			expect(matches).toHaveLength(1);
			expect(matches[0]!.manifest.name).toBe("slack-navigation");
		});

		it("matches wildcard pattern (*.github.com matches github.com)", () => {
			const matches = loader.matchDomain("github.com");
			expect(matches).toHaveLength(1);
			expect(matches[0]!.manifest.name).toBe("github-wildcard");
		});

		it("matches wildcard pattern (*.github.com matches sub.github.com)", () => {
			const matches = loader.matchDomain("sub.github.com");
			expect(matches).toHaveLength(1);
			expect(matches[0]!.manifest.name).toBe("github-wildcard");
		});

		it("matches exact domain for specific subdomain", () => {
			const matches = loader.matchDomain("app.example.com");
			expect(matches).toHaveLength(1);
			expect(matches[0]!.manifest.name).toBe("exact-match");
		});

		it("does not match unrelated domain", () => {
			const matches = loader.matchDomain("totally-different.com");
			expect(matches).toHaveLength(0);
		});

		it("domain matching is case-insensitive", () => {
			const matches = loader.matchDomain("SLACK.COM");
			expect(matches).toHaveLength(1);
		});
	});

	describe("toPrompt formatting", () => {
		it("formats a loaded skill as prompt content", () => {
			const loader = new SkillLoader();
			(loader as any).skills.set("test-skill", {
				manifest: {
					name: "test-skill",
					description: "A test skill",
					version: "1.0",
					domain: "example.com",
					allowedTools: ["click", "type"],
				},
				content: `---
name: test-skill
description: A test skill
version: "1.0"
domain: example.com
allowedTools:
  - click
  - type
---

## Test Skill Body

This is the body content.
`,
				references: new Map(),
			});

			const prompt = loader.toPrompt("test-skill");
			expect(prompt).toContain("## Domain Skill: test-skill");
			expect(prompt).toContain("Domain: example.com");
			expect(prompt).toContain("Description: A test skill");
			expect(prompt).toContain("Version: 1.0");
			expect(prompt).toContain("Allowed Tools: click, type");
			expect(prompt).toContain("## Test Skill Body");
		});

		it("returns empty string for unknown skill", () => {
			const loader = new SkillLoader();
			expect(loader.toPrompt("nonexistent")).toBe("");
		});

		it("includes reference content in prompt", () => {
			const loader = new SkillLoader();
			const refs = new Map<string, string>();
			refs.set("api-docs", "API documentation content here");

			(loader as any).skills.set("with-refs", {
				manifest: {
					name: "with-refs",
					description: "Skill with refs",
					version: "1.0",
					domain: "example.com",
				},
				content:
					'---\nname: with-refs\ndescription: Skill with refs\nversion: "1.0"\ndomain: example.com\n---\n\nBody.',
				references: refs,
			});

			const prompt = loader.toPrompt("with-refs");
			expect(prompt).toContain("### Reference: api-docs");
			expect(prompt).toContain("API documentation content here");
		});
	});

	describe("toContextForDomain", () => {
		it("returns combined context for matching skills", () => {
			const loader = new SkillLoader();
			(loader as any).skills.set("slack-nav", {
				manifest: {
					name: "slack-nav",
					description: "Slack navigation",
					version: "1.0",
					domain: "slack.com",
				},
				content:
					'---\nname: slack-nav\ndescription: Slack navigation\nversion: "1.0"\ndomain: slack.com\n---\n\nUse Ctrl+K.',
				references: new Map(),
			});

			const ctx = loader.toContextForDomain("app.slack.com");
			expect(ctx).toContain("# Domain-Specific Knowledge");
			expect(ctx).toContain("slack-nav");
			expect(ctx).toContain("Use Ctrl+K");
		});

		it("returns empty string when no skills match", () => {
			const loader = new SkillLoader();
			expect(loader.toContextForDomain("no-match.com")).toBe("");
		});
	});

	describe("get / getAll", () => {
		it("get returns a loaded skill by name", () => {
			const loader = new SkillLoader();
			const skill: LoadedSkill = {
				manifest: {
					name: "my-skill",
					description: "Test",
					version: "1.0",
					domain: "test.com",
				},
				content: "content",
				references: new Map(),
			};
			(loader as any).skills.set("my-skill", skill);

			expect(loader.get("my-skill")).toBe(skill);
		});

		it("get returns undefined for unknown skill", () => {
			const loader = new SkillLoader();
			expect(loader.get("unknown")).toBeUndefined();
		});

		it("getAll returns all loaded skills", () => {
			const loader = new SkillLoader();
			const s1: LoadedSkill = {
				manifest: { name: "s1", description: "d1", version: "1", domain: "a.com" },
				content: "",
				references: new Map(),
			};
			const s2: LoadedSkill = {
				manifest: { name: "s2", description: "d2", version: "1", domain: "b.com" },
				content: "",
				references: new Map(),
			};
			(loader as any).skills.set("s1", s1);
			(loader as any).skills.set("s2", s2);

			const all = loader.getAll();
			expect(all).toHaveLength(2);
		});
	});
}); // close describe("SkillLoader")

// ── loadAll tests ────────────────────────────────────────────────────────────

describe("SkillLoader — loadAll", () => {
	it("loads skills from directory entries", async () => {
		const { readdirSync, existsSync, statSync, readFileSync } = await import("node:fs");
		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(statSync as any).mockReturnValue({ isDirectory: () => true });
		vi.mocked(readdirSync as any).mockReturnValue([
			{ name: "slack", isDirectory: () => true },
			{ name: "github", isDirectory: () => true },
			{ name: "not-a-dir.txt", isDirectory: () => false },
		]);
		const SKILL_SLACK = `---
name: slack-skill
description: Slack skill
version: "1.0"
domain: slack.com
---

Slack content.
`;
		const SKILL_GITHUB = `---
name: github-skill
description: GitHub skill
version: "1.0"
domain: github.com
---

GitHub content.
`;
		let readIdx = 0;
		vi.mocked(readFileSync as any).mockImplementation(() => {
			readIdx++;
			return readIdx === 1 ? SKILL_SLACK : SKILL_GITHUB;
		});

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL(["/test-skills"]);
		const count = await loader.loadAll();

		expect(count).toBe(2);
		expect(loader.getAll()).toHaveLength(2);
	});

	it("returns 0 when search path does not exist", async () => {
		const { existsSync } = await import("node:fs");
		vi.mocked(existsSync as any).mockReturnValue(false);

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL(["/nonexistent"]);
		const count = await loader.loadAll();

		expect(count).toBe(0);
	});

	it("returns 0 when search path is not a directory", async () => {
		const { existsSync, statSync } = await import("node:fs");
		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(statSync as any).mockReturnValue({ isDirectory: () => false });

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL(["/test-skills"]);
		const count = await loader.loadAll();

		expect(count).toBe(0);
	});

	it("skips entries that fail to load", async () => {
		const { readdirSync, existsSync, statSync, readFileSync } = await import("node:fs");
		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(statSync as any).mockReturnValue({ isDirectory: () => true });
		vi.mocked(readdirSync as any).mockReturnValue([
			{ name: "good", isDirectory: () => true },
			{ name: "bad", isDirectory: () => true },
		]);

		// First load call succeeds, second fails (no frontmatter)
		let callCount = 0;
		vi.mocked(readFileSync as any).mockImplementation(() => {
			callCount++;
			if (callCount === 1) return VALID_SKILL_MD;
			return INVALID_SKILL_MD;
		});

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL(["/test-skills"]);
		const count = await loader.loadAll();

		expect(count).toBe(1);
	});
});

// ── resolvePath with ~ expansion ────────────────────────────────────────────

describe("SkillLoader — resolvePath", () => {
	it("resolves ~ to home directory", async () => {
		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const resolved = (loader as any).resolvePath("~/skills");
		expect(resolved).not.toContain("~");
		expect(resolved).toContain("skills");
	});

	it("resolves ~ alone to home directory", async () => {
		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const resolved = (loader as any).resolvePath("~");
		expect(resolved).not.toContain("~");
	});

	it("does not expand ~ when not at start", async () => {
		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const resolved = (loader as any).resolvePath("/path/~skills");
		expect(resolved).toContain("~skills");
	});
});

// ── loadReferences ───────────────────────────────────────────────────────────

describe("SkillLoader — loadReferences", () => {
	it("loads reference files when declared in manifest", async () => {
		const { existsSync, readFileSync } = await import("node:fs");

		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(readFileSync as any).mockImplementation((path: string) => {
			if (path.includes("api.md")) return "API doc content";
			if (path.includes("config.md")) return "Config content";
			return "default content";
		});

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();

		// Directly call loadReferences with a mock manifest that has object references
		const refs = await (loader as any).loadReferences("/skills/example/SKILL.md", {
			name: "skill-refs",
			references: {
				"api-docs": "api.md",
				config: "config.md",
			},
		});

		expect(refs.has("api-docs")).toBe(true);
		expect(refs.has("config")).toBe(true);
		expect(refs.get("api-docs")).toBe("API doc content");
		expect(refs.get("config")).toBe("Config content");
	});

	it("skips references when file does not exist", async () => {
		const { existsSync, readFileSync } = await import("node:fs");

		const SKILL_WITH_REFS = `---
name: skill-missing-refs
description: Has missing refs
version: "1.0"
domain: example.com
references:
  missing: non-existent.md
---

Content here.
`;
		let readCount = 0;
		vi.mocked(existsSync as any).mockImplementation(() => {
			readCount++;
			// First call is for the SKILL.md itself, then the ref doesn't exist
			return readCount === 1;
		});
		vi.mocked(readFileSync as any).mockReturnValue(SKILL_WITH_REFS);

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const skill = await loader.load("/skills/example/SKILL.md");

		expect(skill).not.toBeNull();
		expect(skill!.references.has("missing")).toBe(false);
	});

	it("returns empty map when manifest has no references", async () => {
		const loader = new SkillLoader();
		const refs = await (loader as any).loadReferences("/some/path", {
			name: "test",
			description: "test",
			version: "1.0",
			domain: "test.com",
		});
		expect(refs.size).toBe(0);
	});
});

// ── toPrompt without allowedTools ───────────────────────────────────────────

describe("SkillLoader — toPrompt without allowedTools", () => {
	it("omits Allowed Tools line when allowedTools is empty", () => {
		const loader = new SkillLoader();
		(loader as any).skills.set("no-tools", {
			manifest: {
				name: "no-tools",
				description: "No tools",
				version: "1.0",
				domain: "example.com",
			},
			content: "---\nname: no-tools\n---\n\nBody.",
			references: new Map(),
		});

		const prompt = loader.toPrompt("no-tools");
		expect(prompt).not.toContain("Allowed Tools");
	});

	it("omits Allowed Tools line when allowedTools is undefined", () => {
		const loader = new SkillLoader();
		(loader as any).skills.set("undef-tools", {
			manifest: {
				name: "undef-tools",
				description: "Undefined tools",
				version: "1.0",
				domain: "example.com",
				allowedTools: undefined,
			},
			content: "---\nname: undef-tools\n---\n\nBody.",
			references: new Map(),
		});

		const prompt = loader.toPrompt("undef-tools");
		expect(prompt).not.toContain("Allowed Tools");
	});
});

// ── load with readFileSync throwing ──────────────────────────────────────────

describe("SkillLoader — load with read error", () => {
	it("returns null when readFileSync throws", async () => {
		const { existsSync, readFileSync } = await import("node:fs");
		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(readFileSync as any).mockImplementation(() => {
			throw new Error("Permission denied");
		});

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const skill = await loader.load("/skills/forbidden/SKILL.md");
		expect(skill).toBeNull();
	});
});

// ── YAML parsing edge cases ─────────────────────────────────────────────────

describe("SkillLoader — YAML parsing", () => {
	it("handles frontmatter with comment lines", async () => {
		const { existsSync, readFileSync } = await import("node:fs");
		const SKILL_WITH_COMMENTS = `---
# This is a comment
name: commented-skill
description: Has comments
version: "1.0"
domain: example.com
---

Body content.
`;
		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(readFileSync as any).mockReturnValue(SKILL_WITH_COMMENTS);

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const skill = await loader.load("/skills/commented/SKILL.md");

		expect(skill).not.toBeNull();
		expect(skill!.manifest.name).toBe("commented-skill");
	});

	it("rejects malformed YAML lines instead of silently skipping them", async () => {
		const { existsSync, readFileSync } = await import("node:fs");
		const SKILL_BAD_LINE = `---
name: bad-line
description: Has bad line
version: "1.0"
domain: example.com
orphanline
---

Body.
`;
		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(readFileSync as any).mockReturnValue(SKILL_BAD_LINE);

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const skill = await loader.load("/skills/badline/SKILL.md");

		expect(skill).toBeNull();
	});

	it("returns null when frontmatter has no closing delimiter", async () => {
		const { existsSync, readFileSync } = await import("node:fs");
		const NO_CLOSE = `---
name: no-close
description: Missing close
`;
		vi.mocked(existsSync as any).mockReturnValue(true);
		vi.mocked(readFileSync as any).mockReturnValue(NO_CLOSE);

		const { SkillLoader: SL } = await import("../../src/core/skills/SkillLoader");
		const loader = new SL();
		const skill = await loader.load("/skills/noclose/SKILL.md");
		expect(skill).toBeNull();
	});

	it("returns null when content does not start with frontmatter", async () => {
		const loader = new SkillLoader();
		const result = (loader as any).parseFrontmatter("no frontmatter here");
		expect(result).toBeNull();
	});

	it("returns null when trimmed content starts with --- but has no closing ---", () => {
		const loader = new SkillLoader();
		const result = (loader as any).parseFrontmatter("---\nname: test\n");
		expect(result).toBeNull();
	});
});
