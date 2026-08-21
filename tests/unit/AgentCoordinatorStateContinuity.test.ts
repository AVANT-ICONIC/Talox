import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCoordinator } from "../../src/core/AgentCoordinator.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import type { TaloxPageState } from "../../src/types/index.js";

function pageState(url: string, title: string): TaloxPageState {
	return {
		url,
		title,
		timestamp: new Date().toISOString(),
		interactiveElements: [],
		consoleErrors: [],
		bugs: [],
	} as unknown as TaloxPageState;
}

describe("AgentCoordinator state continuity", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("preserves idle agent state and reuses page state returned by actions", async () => {
		vi.spyOn(TaloxController.prototype, "launch").mockResolvedValue(undefined);
		vi.spyOn(TaloxController.prototype, "stop").mockResolvedValue(undefined);

		const stateA0 = pageState("https://a.example/", "A0");
		const stateB0 = pageState("https://b.example/", "B0");
		const stateA1 = pageState("https://a.example/next", "A1");

		vi.spyOn(TaloxController.prototype, "navigate").mockImplementation(async (url) => {
			return url.includes("a.example") ? stateA0 : stateB0;
		});
		const getState = vi.spyOn(TaloxController.prototype, "getState").mockResolvedValue(stateA1);

		const coordinator = new AgentCoordinator({ agents: 2, baseDir: "/tmp/talox-state-continuity" });
		await coordinator.launch({ profileClass: "sandbox", headed: false });

		try {
			const first = await coordinator.run([
				{ agentId: 0, action: "navigate", params: { url: stateA0.url } },
				{ agentId: 1, action: "navigate", params: { url: stateB0.url } },
			]);

			expect(first.states[0]?.title).toBe("A0");
			expect(first.states[1]?.title).toBe("B0");
			// navigate() already returned fresh TaloxPageState values, so the
			// coordinator should not immediately perform duplicate state collection.
			expect(getState).not.toHaveBeenCalled();

			const second = await coordinator.run([{ agentId: 0, action: "wait", params: { ms: 0 } }]);

			expect(getState).toHaveBeenCalledTimes(1);
			expect(second.states[0]?.title).toBe("A1");
			// Agent 1 was idle in the second wave. Its last observed state must stay
			// available to the next planner pass instead of collapsing back to null.
			expect(second.states[1]?.title).toBe("B0");
		} finally {
			await coordinator.stop();
		}
	});
});
