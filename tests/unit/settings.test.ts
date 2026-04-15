import { describe, expect, it } from "vitest";
import { compactState, type TaloxPageState } from "../../src/types/index";

function makeState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Test Page",
		timestamp: "2026-04-02T00:00:00.000Z",
		console: { errors: ["TypeError: Cannot read undefined"], warnings: [], logs: [] },
		network: { failedRequests: [{ url: "https://api.example.com/data", status: 404 }] },
		nodes: [
			{
				id: "n1",
				role: "button",
				name: "Submit",
				boundingBox: { x: 10, y: 20, width: 100, height: 40 },
			},
		],
		interactiveElements: [
			{
				id: "e1",
				tagName: "button",
				role: "button",
				text: "Submit",
				boundingBox: { x: 10, y: 20, width: 100, height: 40 },
				isActionable: true,
			},
		],
		bugs: [
			{
				id: "b1",
				type: "JS_ERROR",
				severity: "MAJOR",
				description: "Unhandled TypeError",
				evidence: {},
			},
		],
		...overrides,
	};
}

describe("compactState()", () => {
	describe("variant 'full'", () => {
		it("returns the original state object unchanged", () => {
			const state = makeState();
			const result = compactState(state, "full");
			expect(result).toBe(state);
		});
	});

	describe("variant 'agent'", () => {
		it("returns url, title, timestamp", () => {
			const state = makeState();
			const result = compactState(state, "agent");
			expect(result.url).toBe(state.url);
			expect(result.title).toBe(state.title);
			expect(result.timestamp).toBe(state.timestamp);
		});

		it("returns interactiveElements", () => {
			const state = makeState();
			const result = compactState(state, "agent");
			expect(result.interactiveElements).toBe(state.interactiveElements);
		});

		it("returns consoleErrors as flat array", () => {
			const state = makeState();
			const result = compactState(state, "agent");
			expect(result.consoleErrors).toEqual(state.console.errors);
		});

		it("returns bugs as minimal shape (type, severity, description)", () => {
			const state = makeState();
			const result = compactState(state, "agent");
			expect(result.bugs).toEqual([{ type: "JS_ERROR", severity: "MAJOR", description: "Unhandled TypeError" }]);
		});

		it("does not include nodes or axTree", () => {
			const state = makeState();
			const result = compactState(state, "agent");
			expect((result as any).nodes).toBeUndefined();
			expect((result as any).axTree).toBeUndefined();
			expect((result as any).network).toBeUndefined();
		});
	});

	describe("variant 'debug'", () => {
		it("returns url, title, timestamp", () => {
			const state = makeState();
			const result = compactState(state, "debug");
			expect(result.url).toBe(state.url);
			expect(result.title).toBe(state.title);
			expect(result.timestamp).toBe(state.timestamp);
		});

		it("returns full nodes array", () => {
			const state = makeState();
			const result = compactState(state, "debug");
			expect(result.nodes).toBe(state.nodes);
		});

		it("returns full console object", () => {
			const state = makeState();
			const result = compactState(state, "debug");
			expect(result.console).toBe(state.console);
		});

		it("returns full network object", () => {
			const state = makeState();
			const result = compactState(state, "debug");
			expect(result.network).toBe(state.network);
		});

		it("returns full bugs array", () => {
			const state = makeState();
			const result = compactState(state, "debug");
			expect(result.bugs).toBe(state.bugs);
		});

		it("does not include interactiveElements", () => {
			const state = makeState();
			const result = compactState(state, "debug");
			expect((result as any).interactiveElements).toBeUndefined();
		});
	});

	describe("empty state", () => {
		it("handles empty arrays for 'agent' variant", () => {
			const state = makeState({
				console: { errors: [] },
				network: { failedRequests: [] },
				nodes: [],
				interactiveElements: [],
				bugs: [],
			});
			const result = compactState(state, "agent");
			expect(result.consoleErrors).toEqual([]);
			expect(result.bugs).toEqual([]);
			expect(result.interactiveElements).toEqual([]);
		});
	});
});
