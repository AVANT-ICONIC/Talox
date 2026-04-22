import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DynamicSkill } from "../../../src/core/loop/types.js";
import type { LoadedSkill } from "../../../src/core/skills/SkillLoader.js";
import { SkillLoader } from "../../../src/core/skills/SkillLoader.js";
import { SkillWriter } from "../../../src/core/skills/SkillWriter.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSkill(overrides?: Partial<DynamicSkill>): DynamicSkill {
	return {
		name: "test-skill",
		description: "A test skill for unit tests",
		domain: "example.com",
		version: "1.0",
		content: "## Test Skill\n\nThis is the body of the test skill.",
		triggerCondition: "url contains example.com",
		toolUsage: ["click", "type"],
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SkillWriter", () => {
	let tempDir: string;
	let loader: SkillLoader;
	let writer: SkillWriter;

	beforeEach(() => {
		tempDir = join(tmpdir(), `talox-skillwriter-test-${Date.now()}`);
		loader = new SkillLoader();
		writer = new SkillWriter(tempDir, loader);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("createSkill", () => {
		it("creates SKILL.md on disk with correct content", async () => {
			const skill = makeSkill();
			const filePath = await writer.createSkill(skill);

			expect(filePath).toBe(join(tempDir, skill.domain, "SKILL.md"));

			const raw = await readFile(filePath, "utf-8");
			expect(raw).toContain("name: test-skill");
			expect(raw).toContain("description: A test skill for unit tests");
			expect(raw).toContain("domain: example.com");
			expect(raw).toContain('version: "1.0"');
			expect(raw).toContain("## Test Skill");
			expect(raw).toContain("This is the body of the test skill.");
		});

		it("creates the domain subdirectory", async () => {
			const skill = makeSkill({ domain: "sub.example.com" });
			const filePath = await writer.createSkill(skill);

			expect(filePath).toBe(join(tempDir, "sub.example.com", "SKILL.md"));
			const raw = await readFile(filePath, "utf-8");
			expect(raw).toContain("domain: sub.example.com");
		});

		it("includes toolUsage as tools in frontmatter", async () => {
			const skill = makeSkill({ toolUsage: ["click", "scroll", "screenshot"] });
			await writer.createSkill(skill);

			const filePath = join(tempDir, skill.domain, "SKILL.md");
			const raw = await readFile(filePath, "utf-8");
			expect(raw).toContain("tools:");
			expect(raw).toContain("  - click");
			expect(raw).toContain("  - scroll");
			expect(raw).toContain("  - screenshot");
		});

		it("omits tools section when toolUsage is empty", async () => {
			const skill = makeSkill({ toolUsage: [] });
			await writer.createSkill(skill);

			const filePath = join(tempDir, skill.domain, "SKILL.md");
			const raw = await readFile(filePath, "utf-8");
			expect(raw).not.toContain("tools:");
		});

		it("includes triggerCondition in frontmatter", async () => {
			const skill = makeSkill({ triggerCondition: "url matches /login/" });
			await writer.createSkill(skill);

			const filePath = join(tempDir, skill.domain, "SKILL.md");
			const raw = await readFile(filePath, "utf-8");
			expect(raw).toContain("trigger: url matches /login/");
		});
	});

	describe("createSkill reloads via loader", () => {
		it("reloads skill after creation via loader", async () => {
			const skill = makeSkill();
			await writer.createSkill(skill);

			const loaded = loader.get(skill.name);
			expect(loaded).toBeDefined();
			expect(loaded!.manifest.name).toBe(skill.name);
			expect(loaded!.manifest.description).toBe(skill.description);
			expect(loaded!.manifest.domain).toBe(skill.domain);
		});

		it("loads skill content correctly after creation", async () => {
			const skill = makeSkill();
			await writer.createSkill(skill);

			const loaded = loader.get(skill.name);
			expect(loaded).toBeDefined();
			expect(loaded!.content).toContain("## Test Skill");
		});
	});

	describe("validateSkill", () => {
		it("validates created skills correctly", async () => {
			const skill = makeSkill();
			await writer.createSkill(skill);

			const valid = await writer.validateSkill(skill.name);
			expect(valid).toBe(true);
		});

		it("returns false for nonexistent skill validation", async () => {
			const valid = await writer.validateSkill("nonexistent-skill");
			expect(valid).toBe(false);
		});

		it("returns false when skill has empty name", async () => {
			// Manually inject a broken skill into the loader
			(loader as any).skills.set("broken", {
				manifest: { name: "", description: "has desc", version: "1.0", domain: "test.com" },
				content: "",
				references: new Map(),
			});

			const valid = await writer.validateSkill("broken");
			expect(valid).toBe(false);
		});

		it("returns false when skill has empty description", async () => {
			(loader as any).skills.set("no-desc", {
				manifest: { name: "no-desc", description: "", version: "1.0", domain: "test.com" },
				content: "",
				references: new Map(),
			});

			const valid = await writer.validateSkill("no-desc");
			expect(valid).toBe(false);
		});
	});

	describe("formatSkillFile", () => {
		it("produces valid SKILL.md format with frontmatter", () => {
			const skill = makeSkill();
			const formatted = writer.formatSkillFile(skill);

			expect(formatted.startsWith("---")).toBe(true);
			expect(formatted).toContain("name: test-skill");
			expect(formatted).toContain("description: A test skill for unit tests");
			expect(formatted).toContain("domain: example.com");
			expect(formatted).toContain('version: "1.0"');
			expect(formatted).toContain("trigger: url contains example.com");
			expect(formatted).toContain("tools:");
			expect(formatted).toContain("  - click");
			expect(formatted).toContain("  - type");
			expect(formatted).toContain("---");
			expect(formatted).toContain("## Test Skill");
		});

		it("separates frontmatter from body with blank line", () => {
			const skill = makeSkill();
			const formatted = writer.formatSkillFile(skill);

			const closingIdx = formatted.indexOf("---", 1);
			const afterFrontmatter = formatted.slice(closingIdx + 3);
			expect(afterFrontmatter.startsWith("\n\n")).toBe(true);
		});

		it("formats skill without tools correctly", () => {
			const skill = makeSkill({ toolUsage: [] });
			const formatted = writer.formatSkillFile(skill);

			expect(formatted).not.toContain("tools:");
			expect(formatted).toContain("trigger:");
		});

		it("round-trips through loader after write", async () => {
			const skill = makeSkill();
			const formatted = writer.formatSkillFile(skill);

			// Write to a temp file and load via a fresh loader
			const dir = join(tempDir, "roundtrip");
			await mkdir(dir, { recursive: true });
			const filePath = join(dir, "SKILL.md");

			const { writeFile: wf } = await import("node:fs/promises");
			await wf(filePath, formatted, "utf-8");

			const freshLoader = new SkillLoader();
			const loaded = await freshLoader.load(filePath);

			expect(loaded).not.toBeNull();
			expect(loaded!.manifest.name).toBe(skill.name);
			expect(loaded!.manifest.domain).toBe(skill.domain);
		});
	});
});
