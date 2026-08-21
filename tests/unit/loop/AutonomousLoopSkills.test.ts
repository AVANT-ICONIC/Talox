import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutonomousLoop } from "../../../src/core/loop/AutonomousLoop.js";
import type { Planner } from "../../../src/core/loop/Planner.js";
import type { PlannerInput } from "../../../src/core/loop/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AutonomousLoop skill loading", () => {
	it("loads configured skills before the first planning iteration", async () => {
		const root = await mkdtemp(join(tmpdir(), "talox-loop-skills-"));
		tempDirs.push(root);
		const skillDir = join(root, "example-workflow");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			`---\nname: example-workflow\ndescription: Example-specific navigation guidance\nversion: 1.0\ndomain: example.com\n---\n\nAlways inspect the primary navigation before acting.\n`,
			"utf-8",
		);

		let plannerInput: PlannerInput | undefined;
		const planner: Planner = {
			plan: vi.fn(async (input: PlannerInput) => {
				plannerInput = input;
				return {
					assessment: "Skill context observed",
					steps: [],
					goalAchieved: true,
				};
			}),
		};

		const controller = {
			on: vi.fn(),
			off: vi.fn(),
			getState: vi.fn().mockResolvedValue({
				url: "https://app.example.com/dashboard",
				title: "Example Dashboard",
				timestamp: new Date().toISOString(),
				interactiveElements: [],
				consoleErrors: [],
				bugs: [],
			}),
			getChallengeState: vi.fn().mockResolvedValue(undefined),
		};

		const loop = new AutonomousLoop(controller as any, {
			goal: { description: "Use the site correctly", maxIterations: 1 },
			planner: { model: "test-model" },
			plannerOverride: planner,
			skillsDir: root,
		});

		const result = await loop.run();
		loop.dispose();

		expect(result.status).toBe("completed");
		expect(plannerInput?.skillsContext).toContain("## Domain Skill: example-workflow");
		expect(plannerInput?.skillsContext).toContain("Always inspect the primary navigation before acting.");
	});
});
