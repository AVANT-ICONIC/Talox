import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedSkill } from "../../src/core/skills/SkillLoader";

// ─── Helpers ────────────────────────────────────────────────────────────────

// vi.mock() factories are hoisted above imports, so we use vi.hoisted()
// to ensure these constants are available when the factory runs.
const { VALID_SKILL_MD, WILDCARD_SKILL_MD, INVALID_SKILL_MD, INCOMPLETE_SKILL_MD } = vi.hoisted(() => {
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

	return {
		VALID_SKILL_MD: VALID,
		WILDCARD_SKILL_MD: WILDCARD,
		INVALID_SKILL_MD: INVALID,
		INCOMPLETE_SKILL_MD: INCOMPLETE,
	};
});

const MINIMAL_SKILL_MD = `---
name: minimal
description: A minimal skill
version: "0.1"
domain: example.com
---

Minimal content.
`;

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
			vi.mock("node:fs", () => ({
				readFileSync: vi.fn().mockReturnValue(VALID_SKILL_MD),
				existsSync: vi.fn().mockReturnValue(true),
				statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
				readdirSync: vi.fn().mockReturnValue([]),
			}));

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
				content: "---\nname: with-refs\ndescription: Skill with refs\nversion: \"1.0\"\ndomain: example.com\n---\n\nBody.",
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
				content: "---\nname: slack-nav\ndescription: Slack navigation\nversion: \"1.0\"\ndomain: slack.com\n---\n\nUse Ctrl+K.",
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
});
