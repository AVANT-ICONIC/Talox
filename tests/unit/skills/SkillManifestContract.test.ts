import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillLoader } from "../../../src/core/skills/SkillLoader.js";
import { SkillWriter } from "../../../src/core/skills/SkillWriter.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(root);
	return root;
}

describe("skill manifest contract", () => {
	it("loads YAML reference mappings and their file contents", async () => {
		const root = await makeTempRoot("talox-skill-refs-");
		const skillDir = join(root, "reference-skill");
		await mkdir(skillDir, { recursive: true });
		await writeFile(join(skillDir, "api.md"), "API reference body", "utf-8");
		await writeFile(join(skillDir, "selectors.md"), "Selector notes", "utf-8");
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---\nname: reference-skill\ndescription: Skill with reference files\nversion: 1.0\ndomain: example.com\nreferences:\n  api: api.md\n  selectors: selectors.md\n---\n\nUse the references.\n`,
			"utf-8",
		);

		const loader = new SkillLoader([root]);
		const skill = await loader.load(join(skillDir, "SKILL.md"));

		expect(skill?.manifest.references).toEqual({ api: "api.md", selectors: "selectors.md" });
		expect(skill?.references.get("api")).toBe("API reference body");
		expect(skill?.references.get("selectors")).toBe("Selector notes");
	});

	it("writes tool restrictions using the manifest's allowedTools field", async () => {
		const root = await makeTempRoot("talox-skill-tools-");
		const loader = new SkillLoader([root]);
		const writer = new SkillWriter(root, loader);

		await writer.createSkill({
			name: "generated-tools",
			description: "Generated tool-restricted skill",
			domain: "example.com",
			version: "1.0",
			content: "Use only the declared tools.",
			triggerCondition: "example condition",
			toolUsage: ["click", "type"],
		});

		const loaded = loader.get("generated-tools");
		expect(loaded?.manifest.allowedTools).toEqual(["click", "type"]);
		expect(loader.toPrompt("generated-tools")).toContain("Allowed Tools: click, type");
	});
});
