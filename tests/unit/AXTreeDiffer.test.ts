import { describe, expect, it } from "vitest";
import { AXTreeDiffer } from "../../src/core/AXTreeDiffer";
import type { TaloxNode, TaloxPageState } from "../../src/types/index";

function makeNode(overrides: Partial<TaloxNode> & { id: string }): TaloxNode {
	return {
		role: "button",
		name: "Click",
		boundingBox: { x: 0, y: 0, width: 100, height: 40 },
		...overrides,
	};
}

function makeState(nodes: TaloxNode[] = []): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Test",
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes,
		interactiveElements: [],
		bugs: [],
	};
}

describe("AXTreeDiffer", () => {
	const differ = new AXTreeDiffer();

	it("detects added nodes", () => {
		const before = makeState([makeNode({ id: "a" })]);
		const after = makeState([makeNode({ id: "a" }), makeNode({ id: "b", role: "link", name: "New Link" })]);
		const result = differ.diff(before, after);
		const added = result.changes.filter((c) => c.type === "added");
		expect(added).toHaveLength(1);
		expect(added[0].nodeId).toBe("b");
		expect(added[0].description).toContain("appeared");
	});

	it("detects removed nodes", () => {
		const before = makeState([makeNode({ id: "a" }), makeNode({ id: "b", role: "heading", name: "Gone" })]);
		const after = makeState([makeNode({ id: "a" })]);
		const result = differ.diff(before, after);
		const removed = result.changes.filter((c) => c.type === "removed");
		expect(removed).toHaveLength(1);
		expect(removed[0].nodeId).toBe("b");
		expect(removed[0].description).toContain("disappeared");
	});

	it("detects moved nodes (position change > 30px)", () => {
		const before = makeState([makeNode({ id: "a", boundingBox: { x: 0, y: 0, width: 100, height: 40 } })]);
		const after = makeState([makeNode({ id: "a", boundingBox: { x: 100, y: 200, width: 100, height: 40 } })]);
		const result = differ.diff(before, after);
		const moved = result.changes.filter((c) => c.type === "moved");
		expect(moved).toHaveLength(1);
		expect(moved[0].previousPosition).toBeDefined();
		expect(moved[0].currentPosition).toBeDefined();
		expect(moved[0].description).toContain("moved");
	});

	it("does not flag small movements (< 30px) as moved", () => {
		const before = makeState([makeNode({ id: "a", boundingBox: { x: 0, y: 0, width: 100, height: 40 } })]);
		const after = makeState([makeNode({ id: "a", boundingBox: { x: 10, y: 10, width: 100, height: 40 } })]);
		const result = differ.diff(before, after);
		expect(result.changes.filter((c) => c.type === "moved")).toHaveLength(0);
	});

	it("detects text/name changes", () => {
		const before = makeState([makeNode({ id: "a", name: "Old Text" })]);
		const after = makeState([makeNode({ id: "a", name: "New Text" })]);
		const result = differ.diff(before, after);
		const changed = result.changes.filter((c) => c.type === "changed");
		expect(changed).toHaveLength(1);
		expect(changed[0].previousValue).toBe("Old Text");
		expect(changed[0].currentValue).toBe("New Text");
	});

	it("detects attribute changes", () => {
		const before = makeState([makeNode({ id: "a", attributes: { disabled: false, ariaLabel: "old" } })]);
		const after = makeState([makeNode({ id: "a", attributes: { disabled: true, ariaLabel: "new" } })]);
		const result = differ.diff(before, after);
		const changed = result.changes.filter((c) => c.type === "changed");
		expect(changed.length).toBeGreaterThanOrEqual(1);
		const attrChange = changed.find((c) => c.description.includes("Attributes"));
		expect(attrChange).toBeDefined();
	});

	it("generates correct summary for mixed changes", () => {
		const before = makeState([makeNode({ id: "a", name: "A" }), makeNode({ id: "b", name: "B" })]);
		const after = makeState([makeNode({ id: "a", name: "A Changed" }), makeNode({ id: "c", name: "C" })]);
		const result = differ.diff(before, after);
		expect(result.summary).toContain("added");
		expect(result.summary).toContain("removed");
		expect(result.summary).toContain("changed");
	});

	it('returns "No changes detected" for identical states', () => {
		const nodes = [makeNode({ id: "a" })];
		const result = differ.diff(makeState(nodes), makeState([...nodes]));
		expect(result.summary).toBe("No changes detected");
		expect(result.changes).toHaveLength(0);
	});

	it("handles movement direction correctly (right and down)", () => {
		const before = makeState([makeNode({ id: "a", boundingBox: { x: 0, y: 0, width: 50, height: 50 } })]);
		const after = makeState([makeNode({ id: "a", boundingBox: { x: 200, y: 200, width: 50, height: 50 } })]);
		const result = differ.diff(before, after);
		const moved = result.changes.find((c) => c.type === "moved");
		expect(moved).toBeDefined();
		expect(moved!.description).toContain("right");
		expect(moved!.description).toContain("down");
	});

	it("handles empty states gracefully", () => {
		const result = differ.diff(makeState([]), makeState([]));
		expect(result.changes).toHaveLength(0);
		expect(result.summary).toBe("No changes detected");
	});
});
