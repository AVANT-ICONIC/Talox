import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillLoader } from "../../../src/core/skills/SkillLoader.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SkillLoader numeric version regression", () => {
	it("preserves an unquoted YAML version such as 1.0 as a string", async () => {
		const root = await mkdtemp(join(tmpdir(), "talox-skill-version-"));
		tempDirs.push(root);
		const skillDir = join(root, "example");
		await mkdir(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");

		await writeFile(
			skillPath,
			`---\nname: numeric-version\ndescription: Accept YAML numeric-looking versions\nversion: 1.0\ndomain: example.com\n---\n\nUse the example workflow.\n`,
			"utf-8",
		);

		const skill = await new SkillLoader([root]).load(skillPath);

		expect(skill).not.toBeNull();
		expect(skill?.manifest.version).toBe("1.0");
	});
});
