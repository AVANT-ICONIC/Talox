import { describe, expect, it } from "vitest";
import { RulesEngine } from "../../src/core/RulesEngine";
import type { TaloxNode, TaloxPageState } from "../../src/types/index";

function makeNode(overrides: Partial<TaloxNode> & { id: string }): TaloxNode {
	return {
		role: "button",
		name: "Click me",
		boundingBox: { x: 0, y: 0, width: 100, height: 40 },
		...overrides,
	};
}

function makeState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Test Page",
		timestamp: new Date().toISOString(),
		console: { errors: [], warnings: [], logs: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
	};
}

describe("RulesEngine", () => {
	const engine = new RulesEngine();

	describe("analyze", () => {
		it("detects JS console errors as CRITICAL bugs", () => {
			const state = makeState({
				console: { errors: ["Uncaught TypeError: x is not a function"] },
			});
			const bugs = engine.analyze(state);
			expect(bugs.length).toBe(1);
			expect(bugs[0].type).toBe("JS_ERROR");
			expect(bugs[0].severity).toBe("CRITICAL");
			expect(bugs[0].description).toContain("Uncaught TypeError");
		});

		it("detects multiple console errors", () => {
			const state = makeState({
				console: { errors: ["Error A", "Error B", "Error C"] },
			});
			const bugs = engine.analyze(state);
			expect(bugs.filter((b) => b.type === "JS_ERROR")).toHaveLength(3);
		});

		it("detects overlapping interactive elements", () => {
			const state = makeState({
				interactiveElements: [
					{
						id: "a",
						tagName: "button",
						boundingBox: { x: 0, y: 0, width: 100, height: 100 },
					},
					{
						id: "b",
						tagName: "div",
						boundingBox: { x: 10, y: 10, width: 100, height: 100 },
					},
				],
			});
			const bugs = engine.analyze(state);
			const overlapBugs = bugs.filter((b) => b.type === "VISUAL_OVERLAP");
			expect(overlapBugs.length).toBe(1);
			expect(overlapBugs[0].severity).toBe("MAJOR");
			expect(overlapBugs[0].evidence.overlapArea).toBeGreaterThan(0);
		});

		it("does not flag non-overlapping elements", () => {
			const state = makeState({
				interactiveElements: [
					{
						id: "a",
						tagName: "button",
						boundingBox: { x: 0, y: 0, width: 50, height: 50 },
					},
					{
						id: "b",
						tagName: "div",
						boundingBox: { x: 200, y: 200, width: 50, height: 50 },
					},
				],
			});
			const bugs = engine.analyze(state);
			expect(bugs.filter((b) => b.type === "VISUAL_OVERLAP")).toHaveLength(0);
		});

		it("detects elements clipped outside the viewport", () => {
			const state = makeState({
				interactiveElements: [
					{
						id: "clipped",
						tagName: "button",
						boundingBox: { x: 1200, y: 600, width: 200, height: 200 },
					},
				],
			});
			const bugs = engine.analyze(state);
			const clipBugs = bugs.filter((b) => b.type === "VISUAL_CLIPPING");
			expect(clipBugs.length).toBe(1);
			expect(clipBugs[0].severity).toBe("MINOR");
			expect(clipBugs[0].description).toContain("partially outside the viewport");
		});

		it("does not flag elements within the viewport", () => {
			const state = makeState({
				interactiveElements: [
					{
						id: "safe",
						tagName: "button",
						boundingBox: { x: 100, y: 100, width: 200, height: 200 },
					},
				],
			});
			const bugs = engine.analyze(state);
			expect(bugs.filter((b) => b.type === "VISUAL_CLIPPING")).toHaveLength(0);
		});

		it("returns empty array for a clean page state", () => {
			const state = makeState();
			const bugs = engine.analyze(state);
			expect(bugs).toEqual([]);
		});

		it("handles elements with zero area gracefully in overlap check", () => {
			const state = makeState({
				interactiveElements: [
					{
						id: "zero1",
						tagName: "span",
						boundingBox: { x: 0, y: 0, width: 0, height: 0 },
					},
					{
						id: "zero2",
						tagName: "span",
						boundingBox: { x: 0, y: 0, width: 0, height: 0 },
					},
				],
			});
			const bugs = engine.analyze(state);
			expect(bugs.filter((b) => b.type === "VISUAL_OVERLAP")).toHaveLength(0);
		});
	});

	describe("diffStructural", () => {
		it("detects missing AX-tree nodes in new state", () => {
			const oldState = makeState({
				nodes: [makeNode({ id: "n1", role: "button", name: "Submit" })],
			});
			const newState = makeState({ nodes: [] });
			const bugs = engine.diffStructural(oldState, newState);
			expect(bugs.length).toBe(1);
			expect(bugs[0].type).toBe("STRUCTURAL_REGRESSION");
			expect(bugs[0].description).toContain("Submit");
		});

		it("detects missing interactive elements in new state", () => {
			const oldState = makeState({
				interactiveElements: [{ id: "btn1", tagName: "button", boundingBox: { x: 0, y: 0, width: 100, height: 40 } }],
			});
			const newState = makeState({ interactiveElements: [] });
			const bugs = engine.diffStructural(oldState, newState);
			expect(bugs.length).toBe(1);
			expect(bugs[0].type).toBe("STRUCTURAL_REGRESSION");
			expect(bugs[0].description).toContain("button");
		});

		it("returns empty when states are identical", () => {
			const nodes = [makeNode({ id: "n1" })];
			const els = [{ id: "e1", tagName: "button", boundingBox: { x: 0, y: 0, width: 100, height: 40 } }];
			const oldState = makeState({ nodes, interactiveElements: els });
			const newState = makeState({ nodes, interactiveElements: els });
			const bugs = engine.diffStructural(oldState, newState);
			expect(bugs).toEqual([]);
		});

		it("does not flag nodes added in new state", () => {
			const oldState = makeState({ nodes: [] });
			const newState = makeState({
				nodes: [makeNode({ id: "n2", role: "link", name: "New" })],
			});
			const bugs = engine.diffStructural(oldState, newState);
			expect(bugs).toEqual([]);
		});
	});
});
