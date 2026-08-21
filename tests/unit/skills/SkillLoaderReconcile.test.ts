import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillLoader } from "../../../src/core/skills/SkillLoader.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function writeSkill(root: string, dirName: string, name: string, domain: string): Promise<string> {
	const dir = join(root, dirName);
	await mkdir(dir, { recursive: true });
	const path = join(dir, "SKILL.md");
	await writeFile(
		path,
		`---\nname: ${name}\ndescription: ${name} description\nversion: 1.0\ndomain: ${domain}\n---\n\n${name} body\n`,
		"utf-8",
	);
	return path;
}

describe("SkillLoader registry reconciliation", () => {
	it("removes deleted or renamed managed skills while preserving explicit external loads", async () => {
		const managedRoot = await makeTempDir("talox-managed-skills-");
		const externalRoot = await makeTempDir("talox-external-skill-");
		await writeSkill(managedRoot, "alpha", "alpha", "alpha.example");
		await writeSkill(managedRoot, "beta", "beta", "beta.example");
		const externalPath = await writeSkill(externalRoot, "external", "external", "external.example");

		const loader = new SkillLoader([managedRoot]);
		await loader.load(externalPath);
		expect(await loader.loadAll()).toBe(2);
		expect(
			loader
				.getAll()
				.map((skill) => skill.manifest.name)
				.sort(),
		).toEqual(["alpha", "beta", "external"]);

		await rm(join(managedRoot, "beta"), { recursive: true, force: true });
		await writeSkill(managedRoot, "alpha", "alpha-renamed", "alpha.example");

		expect(await loader.loadAll()).toBe(1);
		expect(loader.get("alpha")).toBeUndefined();
		expect(loader.get("beta")).toBeUndefined();
		expect(loader.get("alpha-renamed")?.manifest.domain).toBe("alpha.example");
		expect(loader.get("external")?.manifest.domain).toBe("external.example");
	});

	it("removes a managed skill whose manifest becomes invalid", async () => {
		const managedRoot = await makeTempDir("talox-invalidated-skill-");
		const skillPath = await writeSkill(managedRoot, "alpha", "alpha", "alpha.example");
		const loader = new SkillLoader([managedRoot]);

		expect(await loader.loadAll()).toBe(1);
		expect(loader.get("alpha")).toBeDefined();

		await writeFile(skillPath, "---\nname: alpha\n---\nMissing required fields.\n", "utf-8");

		expect(await loader.loadAll()).toBe(0);
		expect(loader.get("alpha")).toBeUndefined();
	});
});
