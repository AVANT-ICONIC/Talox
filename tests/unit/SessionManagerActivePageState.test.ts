import { describe, expect, it, vi } from "vitest";
import type { TaloxPageState } from "../../src/types/index.js";
import { SessionManager } from "../../src/core/controller/SessionManager.js";

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

function makeCollector(state: TaloxPageState) {
	const close = vi.fn().mockResolvedValue(undefined);
	return {
		collector: {
			getLastState: vi.fn(() => state),
			getPage: () => ({ close }),
		} as any,
		close,
	};
}

describe("SessionManager active page state", () => {
	it("switches the session cache to the selected page without recollecting", () => {
		const session = new SessionManager(
			{ automaticThinkingEnabled: false, verbosity: 0 } as any,
			{ emit: vi.fn() } as any,
			".",
		);
		const firstState = makeState("https://first.example");
		const secondState = makeState("https://second.example");
		const first = makeCollector(firstState);
		const second = makeCollector(secondState);

		session.pages = [first.collector, second.collector];
		session.activePageIndex = 0;
		session.lastState = firstState;

		session.switchPage(1);

		expect(session.activePageIndex).toBe(1);
		expect(session.lastState).toBe(secondState);
		expect(second.collector.getLastState).toHaveBeenCalledOnce();
	});

	it("switches the session cache to the surviving page when the active page closes", async () => {
		const session = new SessionManager(
			{ automaticThinkingEnabled: false, verbosity: 0 } as any,
			{ emit: vi.fn() } as any,
			".",
		);
		const firstState = makeState("https://first.example");
		const secondState = makeState("https://second.example");
		const first = makeCollector(firstState);
		const second = makeCollector(secondState);

		session.pages = [first.collector, second.collector];
		session.activePageIndex = 1;
		session.lastState = secondState;

		await session.closePage(1);

		expect(second.close).toHaveBeenCalledOnce();
		expect(session.activePageIndex).toBe(0);
		expect(session.lastState).toBe(firstState);
		expect(first.collector.getLastState).toHaveBeenCalledOnce();
	});

	it("clears the session cache when the final page closes", async () => {
		const session = new SessionManager(
			{ automaticThinkingEnabled: false, verbosity: 0 } as any,
			{ emit: vi.fn() } as any,
			".",
		);
		const state = makeState("https://only.example");
		const only = makeCollector(state);

		session.pages = [only.collector];
		session.activePageIndex = 0;
		session.lastState = state;

		await session.closePage(0);

		expect(session.activePageIndex).toBe(-1);
		expect(session.lastState).toBeNull();
	});
});
