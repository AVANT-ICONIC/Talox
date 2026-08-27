import { describe, expect, it } from "vitest";
import { diffPageState, type TaloxPageState } from "../../src/types/index.js";

function interactive(id: string) {
	return {
		id,
		tagName: "button",
		boundingBox: { x: 0, y: 0, width: 100, height: 40 },
	};
}

function state(ids: string[]): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Example",
		timestamp: "2026-08-27T10:00:00.000Z",
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: ids.map(interactive),
		bugs: [],
	};
}

describe("diffPageState interactive-element deltas", () => {
	it("detects equal-count replacement", () => {
		const diff = diffPageState(state(["#old"]), state(["#new"]));
		expect(diff.interactiveAdded).toBe(1);
		expect(diff.interactiveRemoved).toBe(1);
	});

	it("detects pure additions", () => {
		const diff = diffPageState(state(["#a"]), state(["#a", "#b"]));
		expect(diff.interactiveAdded).toBe(1);
		expect(diff.interactiveRemoved).toBe(0);
	});

	it("detects pure removals", () => {
		const diff = diffPageState(state(["#a", "#b"]), state(["#a"]));
		expect(diff.interactiveAdded).toBe(0);
		expect(diff.interactiveRemoved).toBe(1);
	});

	it("reports no delta when IDs are unchanged", () => {
		const diff = diffPageState(state(["#a", "#b"]), state(["#a", "#b"]));
		expect(diff.interactiveAdded).toBe(0);
		expect(diff.interactiveRemoved).toBe(0);
	});
});
