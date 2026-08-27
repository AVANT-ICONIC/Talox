import { describe, expect, it, vi } from "vitest";
import type { TaloxPageState } from "../../src/types/index.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function makeState(url: string): TaloxPageState {
	return {
		url,
		title: url,
		timestamp: new Date(0).toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
	};
}

describe("TaloxController action state synchronization", () => {
	it("stores the post-click state as the session's current state", async () => {
		const controller = new TaloxController(".");
		const before = makeState("https://example.com/before-click");
		const after = makeState("https://example.com/after-click");
		controller._session.lastState = before;
		vi.spyOn(controller._actions, "click").mockResolvedValue(after);
		vi.spyOn(controller._adapt, "evaluate").mockResolvedValue(false);
		vi.spyOn(controller._adapt, "recordStrategySuccess").mockImplementation(() => undefined);

		const result = await controller.click("#submit");

		expect(result).toBe(after);
		expect(controller._session.lastState).toBe(after);
	});

	it("stores the post-type state as the session's current state", async () => {
		const controller = new TaloxController(".");
		const before = makeState("https://example.com/before-type");
		const after = makeState("https://example.com/after-type");
		controller._session.lastState = before;
		vi.spyOn(controller._actions, "type").mockResolvedValue(after);

		const result = await controller.type("#email", "agent@example.com");

		expect(result).toBe(after);
		expect(controller._session.lastState).toBe(after);
	});
});
