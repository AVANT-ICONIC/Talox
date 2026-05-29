import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillVersioning } from "../../../../src/core/research/SkillVersioning.js";
import type { RunMetrics } from "../../../../src/core/research/types.js";

function makeMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
	return {
		iterationsToGoal: 5,
		totalDurationMs: 1000,
		totalCostUsd: 0.01,
		blockerCount: 0,
		blockerTypes: [],
		goalAchieved: true,
		skillsCreated: 0,
		strategySuccessRate: 1.0,
		...overrides,
	};
}

describe("SkillVersioning — Integration", () => {
	let sv: SkillVersioning;
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "talox-sv-int-"));
		sv = new SkillVersioning(tmpDir, 5);
		await sv.initialize();
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	it("commits versions and tracks current", async () => {
		const v1 = await sv.commit("stealth-skill", "version 1 content", makeMetrics({ iterationsToGoal: 10 }));
		expect(v1).toBe("v1");

		const v2 = await sv.commit("stealth-skill", "version 2 content", makeMetrics({ iterationsToGoal: 5 }));
		expect(v2).toBe("v2");

		const current = await sv.getCurrent("stealth-skill");
		expect(current!.version).toBe("v2");
		expect(current!.isCurrent).toBe(true);
		expect(current!.content).toBe("version 2 content");
	});

	it("rolls back to a specific version", async () => {
		await sv.commit("stealth-skill", "v1", makeMetrics({ goalAchieved: true }));
		await sv.commit("stealth-skill", "v2", makeMetrics({ goalAchieved: false }));
		await sv.commit("stealth-skill", "v3", makeMetrics({ goalAchieved: false }));

		const rolled = await sv.rollback("stealth-skill", "v1");
		expect(rolled!.version).toBe("v1");
		expect(rolled!.isCurrent).toBe(true);

		const current = await sv.getCurrent("stealth-skill");
		expect(current!.version).toBe("v1");
		expect(current!.content).toBe("v1");
	});

	it("rolls back to best-performing version", async () => {
		await sv.commit("skill", "bad", makeMetrics({ goalAchieved: false, iterationsToGoal: 20 }));
		await sv.commit("skill", "medium", makeMetrics({ goalAchieved: true, iterationsToGoal: 8 }));
		await sv.commit("skill", "best", makeMetrics({ goalAchieved: true, iterationsToGoal: 3 }));

		const best = await sv.rollbackToBest("skill");
		expect(best!.content).toBe("best");
		expect(best!.isCurrent).toBe(true);
	});

	it("persists versions to disk and survives reinitialization", async () => {
		await sv.commit("persisted-skill", "content", makeMetrics());

		// New instance pointing to same dir
		const sv2 = new SkillVersioning(tmpDir, 5);
		await sv2.initialize();

		const current = await sv2.getCurrent("persisted-skill");
		expect(current).not.toBeNull();
		expect(current!.content).toBe("content");
		expect(current!.version).toBe("v1");
	});

	it("prunes old versions when exceeding maxVersions", async () => {
		const svSmall = new SkillVersioning(tmpDir, 3);
		await svSmall.initialize();

		await svSmall.commit("p", "v1", makeMetrics());
		await svSmall.commit("p", "v2", makeMetrics());
		await svSmall.commit("p", "v3", makeMetrics());
		await svSmall.commit("p", "v4", makeMetrics());
		await svSmall.commit("p", "v5", makeMetrics());

		const count = await svSmall.getVersionCount("p");
		expect(count).toBeLessThanOrEqual(3);

		const current = await svSmall.getCurrent("p");
		expect(current).not.toBeNull();
		expect(current!.version).toBeTruthy();
	});

	it("handles deleteAllVersions", async () => {
		await sv.commit("doomed", "v1");
		await sv.commit("doomed", "v2");

		await sv.deleteAllVersions("doomed");
		const versions = await sv.getVersions("doomed");
		expect(versions).toHaveLength(0);

		const current = await sv.getCurrent("doomed");
		expect(current).toBeNull();
	});

	it("isolates different skills", async () => {
		await sv.commit("skill-a", "content a", makeMetrics({ iterationsToGoal: 3 }));
		await sv.commit("skill-b", "content b", makeMetrics({ iterationsToGoal: 7 }));

		const a = await sv.getCurrent("skill-a");
		const b = await sv.getCurrent("skill-b");
		expect(a!.content).toBe("content a");
		expect(b!.content).toBe("content b");
	});
});
