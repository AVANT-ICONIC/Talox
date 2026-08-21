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

describe("AgentCoordinator lifecycle state hardening", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("preserves the last known page state when post-action state collection fails transiently", async () => {
		vi.spyOn(TaloxController.prototype, "launch").mockResolvedValue(undefined);
		vi.spyOn(TaloxController.prototype, "stop").mockResolvedValue(undefined);
		const known = pageState("https://known.example/", "Known");
		vi.spyOn(TaloxController.prototype, "navigate").mockResolvedValue(known);
		const getState = vi
			.spyOn(TaloxController.prototype, "getState")
			.mockRejectedValue(new Error("synthetic transient state failure"));

		const coordinator = new AgentCoordinator({ agents: 1, baseDir: "/tmp/talox-state-hardening" });
		await coordinator.launch({ profileClass: "sandbox", headed: false });

		try {
			const first = await coordinator.run([
				{ agentId: 0, action: "navigate", params: { url: known.url } },
			]);
			expect(first.states[0]?.url).toBe(known.url);
			expect(getState).not.toHaveBeenCalled();

			const second = await coordinator.run([{ agentId: 0, action: "wait", params: { ms: 0 } }]);
			expect(getState).toHaveBeenCalledTimes(1);
			expect(second.states[0]?.url).toBe(known.url);
			expect(coordinator.getStatus()[0]?.currentUrl).toBe(known.url);
		} finally {
			await coordinator.stop();
		}
	});

	it("clears currentUrl and lastResult when stopped before coordinator reuse", async () => {
		vi.spyOn(TaloxController.prototype, "launch").mockResolvedValue(undefined);
		vi.spyOn(TaloxController.prototype, "stop").mockResolvedValue(undefined);
		const known = pageState("https://status.example/", "Status");
		vi.spyOn(TaloxController.prototype, "navigate").mockResolvedValue(known);

		const coordinator = new AgentCoordinator({ agents: 1, baseDir: "/tmp/talox-status-hardening" });
		await coordinator.launch({ profileClass: "sandbox", headed: false });
		await coordinator.run([{ agentId: 0, action: "navigate", params: { url: known.url } }]);

		const active = coordinator.getStatus()[0];
		expect(active?.currentUrl).toBe(known.url);
		expect(active?.lastResult?.success).toBe(true);

		await coordinator.stop();

		const stopped = coordinator.getStatus()[0];
		expect(stopped?.busy).toBe(false);
		expect(stopped?.currentUrl).toBeUndefined();
		expect(stopped?.lastResult).toBeUndefined();
	});
});
