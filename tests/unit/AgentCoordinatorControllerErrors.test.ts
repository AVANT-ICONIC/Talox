import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCoordinator } from "../../src/core/AgentCoordinator.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import type { TaloxPageState } from "../../src/types/index.js";

function pageState(url: string, title: string): TaloxPageState {
	return {
		url,
		title,
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
	} as unknown as TaloxPageState;
}

function controllerErrorState(message: string): TaloxPageState {
	return {
		url: "",
		title: "Error",
		timestamp: new Date().toISOString(),
		console: { errors: [message] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
	} as unknown as TaloxPageState;
}

describe("AgentCoordinator controller error states", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("marks controller-returned error states as failures and does not merge them into shared state", async () => {
		vi.spyOn(TaloxController.prototype, "launch").mockResolvedValue(undefined);
		vi.spyOn(TaloxController.prototype, "stop").mockResolvedValue(undefined);
		const errorState = controllerErrorState("synthetic navigation failure");
		const stableState = pageState("about:blank", "Blank");
		vi.spyOn(TaloxController.prototype, "navigate").mockResolvedValue(errorState);
		vi.spyOn(TaloxController.prototype, "getState").mockResolvedValue(stableState);

		const coordinator = new AgentCoordinator({ agents: 1, baseDir: "/tmp/talox-controller-error" });
		await coordinator.launch({ profileClass: "sandbox", headed: false });

		try {
			const result = await coordinator.run([
				{
					agentId: 0,
					action: "navigate",
					params: { url: "https://failure.example" },
					resultKey: "navigation",
				},
			]);

			expect(result.results).toHaveLength(1);
			expect(result.results[0]?.success).toBe(false);
			expect(result.results[0]?.error).toBe("synthetic navigation failure");
			expect(result.results[0]?.data).toBe(errorState);
			expect(result.results[0]?.mergedToSharedState).toBeUndefined();
			expect(result.sharedState).not.toHaveProperty("navigation");
			expect(result.states[0]?.url).toBe("about:blank");
			expect(coordinator.getStatus()[0]?.lastResult?.success).toBe(false);
		} finally {
			await coordinator.stop();
		}
	});
});
