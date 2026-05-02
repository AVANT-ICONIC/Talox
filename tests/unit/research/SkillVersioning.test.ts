import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillVersioning } from "../../../src/core/research/SkillVersioning.js";
import { rm } from "node:fs/promises";

function makeMetrics(goalAchieved = true, iterationsToGoal = 5) {
	return {
		iterationsToGoal,
		totalDurationMs: 500,
		totalCostUsd: 0.01,
		blockerCount: 0,
		blockerTypes: [] as string[],
		goalAchieved,
		skillsCreated: 0,
		strategySuccessRate: 0.8,
	};
}

describe("SkillVersioning", () => {
	let versioning: SkillVersioning;
	let testDir: string;

	beforeEach(async () => {
		testDir = `/tmp/talox-test-skill-versions-${Date.now()}`;
		versioning = new SkillVersioning(testDir, 5);
		await versioning.initialize();
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("initializes by creating directory", async () => {
		const freshDir = `${testDir}/fresh`;
		const sv = new SkillVersioning(freshDir, 5);
		await sv.initialize();
		const count = await sv.getVersionCount("anything");
		expect(count).toBe(0);
	});

	it("commits a new version and retrieves it", async () => {
		const v = await versioning.commit("my-skill", "version 1 content");
		expect(v).toBe("v1");

		const current = await versioning.getCurrent("my-skill");
		expect(current).not.toBeNull();
		expect(current!.content).toBe("version 1 content");
		expect(current!.isCurrent).toBe(true);
	});

	it("increments version numbers", async () => {
		await versioning.commit("my-skill", "v1");
		await versioning.commit("my-skill", "v2");
		await versioning.commit("my-skill", "v3");

		const versions = await versioning.getVersions("my-skill");
		expect(versions).toHaveLength(3);
		expect(versions[0]!.version).toBe("v1");
		expect(versions[1]!.version).toBe("v2");
		expect(versions[2]!.version).toBe("v3");
	});

	it("enforces maxVersions limit", async () => {
		const sv = new SkillVersioning(testDir, 3);
		await sv.initialize();
		await sv.commit("my-skill", "v1");
		await sv.commit("my-skill", "v2");
		await sv.commit("my-skill", "v3");
		await sv.commit("my-skill", "v4");
		await sv.commit("my-skill", "v5");

		const versions = await sv.getVersions("my-skill");
		expect(versions.length).toBeLessThanOrEqual(3);
	});

	it("getCurrent returns the most recent version", async () => {
		await versioning.commit("my-skill", "old");
		await versioning.commit("my-skill", "newest");
		const latest = await versioning.getCurrent("my-skill");
		expect(latest).not.toBeNull();
		expect(latest!.content).toBe("newest");
	});

	it("getCurrent returns null for unknown skill", async () => {
		expect(await versioning.getCurrent("unknown")).toBeNull();
	});

	it("rollback restores a specific version as current", async () => {
		await versioning.commit("my-skill", "v1");
		await versioning.commit("my-skill", "v2-bad");
		await versioning.commit("my-skill", "v3-bad");

		await versioning.rollback("my-skill", "v1");
		const current = await versioning.getCurrent("my-skill");
		expect(current!.content).toBe("v1");
		expect(current!.isCurrent).toBe(true);
	});

	it("rollbackToBest restores the version with best metrics", async () => {
		await versioning.commit("my-skill", "v1", makeMetrics(true, 10));
		await versioning.commit("my-skill", "v2", makeMetrics(true, 2)); // best: fewest iterations
		await versioning.commit("my-skill", "v3", makeMetrics(true, 20));

		await versioning.rollbackToBest("my-skill");
		const current = await versioning.getCurrent("my-skill");
		expect(current!.content).toBe("v2");
	});

	it("rollback returns null for non-existent version", async () => {
		await versioning.commit("my-skill", "v1");
		const result = await versioning.rollback("my-skill", "v99");
		expect(result).toBeNull();
	});

	it("getVersionCount returns correct count", async () => {
		expect(await versioning.getVersionCount("my-skill")).toBe(0);
		await versioning.commit("my-skill", "v1");
		expect(await versioning.getVersionCount("my-skill")).toBe(1);
	});

	it("persists versions to disk", async () => {
		await versioning.commit("my-skill", "persisted");

		const sv2 = new SkillVersioning(testDir, 5);
		await sv2.initialize();
		const versions = await sv2.getVersions("my-skill");
		expect(versions.length).toBeGreaterThanOrEqual(1);
		expect(versions[0]!.content).toBe("persisted");
	});

	it("deleteAllVersions removes all versions of a skill", async () => {
		await versioning.commit("my-skill", "v1");
		await versioning.commit("my-skill", "v2");
		await versioning.deleteAllVersions("my-skill");
		expect(await versioning.getVersionCount("my-skill")).toBe(0);
	});

	it("marks only latest commit as current", async () => {
		await versioning.commit("my-skill", "v1");
		await versioning.commit("my-skill", "v2");

		const versions = await versioning.getVersions("my-skill");
		const currents = versions.filter((v) => v.isCurrent);
		expect(currents).toHaveLength(1);
		expect(currents[0]!.content).toBe("v2");
	});
});
