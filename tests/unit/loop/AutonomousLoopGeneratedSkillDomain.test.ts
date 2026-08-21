import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type { Planner } from "../../../src/core/loop/Planner.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AutonomousLoop generated skill domain", () => {
	it("writes blocker-generated skills under the observed hostname and reports the persisted skill name", async () => {
		const skillsDir = await mkdtemp(join(tmpdir(), "talox-generated-domain-"));
		tempDirs.push(skillsDir);

		const planner: Planner = {
			plan: vi.fn().mockResolvedValue({
				assessment: "Login wall blocks progress",
				steps: [],
				goalAchieved: false,
				blocker: {
					type: "login-wall",
					confidence: 1,
					description: "Authentication is required",
					evidence: ["Sign in"],
					autoResolvable: false,
					suggestedApproach: "Resume after authentication.",
				},
			}),
		};

		const controller = {
			on: vi.fn(),
			off: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				url: "https://app.example.com/login",
				title: "Sign in",
				timestamp: new Date().toISOString(),
				interactiveElements: [],
				consoleErrors: [],
				bugs: [],
			}),
			getChallengeState: vi.fn().mockResolvedValue(undefined),
		};

		const loop = new AutonomousLoop(controller as any, {
			goal: { description: "Open the dashboard", maxIterations: 1 },
			planner: { model: "test-model" },
			plannerOverride: planner,
			skillsDir,
		});

		const result = await loop.run();
		loop.dispose();
		const domains = await readdir(skillsDir);
		const persistedSkill = await readFile(join(skillsDir, "app.example.com", "SKILL.md"), "utf-8");

		expect(result.status).toBe("human-takeover");
		expect(domains).toContain("app.example.com");
		expect(domains).not.toContain("unknown");
		expect(result.createdSkills).toEqual(["blocker-login-wall"]);
		expect(persistedSkill).toContain("name: blocker-login-wall");
	});
});
