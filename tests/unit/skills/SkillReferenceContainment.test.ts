import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillLoader } from "../../../src/core/skills/SkillLoader.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeFixture(references: Record<string, string>): Promise<{
	root: string;
	skillDir: string;
	skillPath: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "talox-skill-reference-"));
	tempDirs.push(root);
	const skillDir = join(root, "skill");
	await mkdir(skillDir, { recursive: true });

	const referenceYaml = Object.entries(references)
		.map(([name, path]) => `  ${name}: ${JSON.stringify(path)}`)
		.join("\n");
	const skillPath = join(skillDir, "SKILL.md");
	await writeFile(
		skillPath,
		`---\nname: containment-test\ndescription: Reference containment test\nversion: 1.0\ndomain: example.com\nreferences:\n${referenceYaml}\n---\n\nUse the declared references.\n`,
		"utf-8",
	);

	return { root, skillDir, skillPath };
}

describe("SkillLoader reference containment", () => {
	it("loads nested references whose canonical target stays inside the skill directory", async () => {
		const { skillDir, skillPath } = await makeFixture({ api: "docs/api.md" });
		await mkdir(join(skillDir, "docs"), { recursive: true });
		await writeFile(join(skillDir, "docs", "api.md"), "safe nested reference", "utf-8");

		const skill = await new SkillLoader().load(skillPath);

		expect(skill?.references.get("api")).toBe("safe nested reference");
	});

	it("skips parent-directory traversal references", async () => {
		const { root, skillPath } = await makeFixture({ secret: "../secret.md" });
		await writeFile(join(root, "secret.md"), "outside secret", "utf-8");

		const skill = await new SkillLoader().load(skillPath);

		expect(skill).not.toBeNull();
		expect(skill?.references.has("secret")).toBe(false);
	});

	it("skips absolute references outside the skill directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "talox-skill-reference-outside-"));
		tempDirs.push(root);
		const outsidePath = join(root, "absolute-secret.md");
		await writeFile(outsidePath, "absolute outside secret", "utf-8");
		const fixture = await makeFixture({ secret: outsidePath });

		const skill = await new SkillLoader().load(fixture.skillPath);

		expect(skill).not.toBeNull();
		expect(skill?.references.has("secret")).toBe(false);
	});

	it.skipIf(process.platform === "win32")(
		"skips symlinks whose canonical target escapes the skill directory",
		async () => {
			const { root, skillDir, skillPath } = await makeFixture({ secret: "linked-secret.md" });
			const outsidePath = join(root, "outside-secret.md");
			await writeFile(outsidePath, "symlink outside secret", "utf-8");
			await symlink(outsidePath, join(skillDir, "linked-secret.md"));

			const skill = await new SkillLoader().load(skillPath);

			expect(skill).not.toBeNull();
			expect(skill?.references.has("secret")).toBe(false);
		},
	);
});
