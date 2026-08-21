import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCoordinator } from "../../src/core/AgentCoordinator.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

describe("AgentCoordinator lifecycle", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("rejects non-positive and non-integer agent counts", () => {
		expect(() => new AgentCoordinator({ agents: 0 })).toThrow("positive integer agent count");
		expect(() => new AgentCoordinator({ agents: -1 })).toThrow("positive integer agent count");
		expect(() => new AgentCoordinator({ agents: 1.5 })).toThrow("positive integer agent count");
	});

	it("cleans up the failing controller and already-started agents when launch is partial", async () => {
		const launch = vi.spyOn(TaloxController.prototype, "launch");
		launch.mockResolvedValueOnce(undefined);
		launch.mockRejectedValueOnce(new Error("synthetic second-agent launch failure"));
		const stop = vi.spyOn(TaloxController.prototype, "stop").mockResolvedValue(undefined);

		const coordinator = new AgentCoordinator({ agents: 2, baseDir: "/tmp/talox-coordinator-test" });

		await expect(coordinator.launch({ profileClass: "sandbox" })).rejects.toThrow(
			"synthetic second-agent launch failure",
		);

		// One stop for the failing controller, one for the previously launched agent.
		expect(stop).toHaveBeenCalledTimes(2);
		expect(coordinator.getAgent(0)).toBeUndefined();
		expect(coordinator.getAgent(1)).toBeUndefined();
		expect(coordinator.getStatus().every((status) => status.busy === false)).toBe(true);
	});
});
