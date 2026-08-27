import { describe, expect, it } from "vitest";
import { diffPageState, type TaloxNode, type TaloxPageState } from "../../src/types/index.js";

function pageState(node: TaloxNode): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Example",
		timestamp: "2026-08-27T10:00:00.000Z",
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [node],
		interactiveElements: [],
		bugs: [],
	};
}

const baseNode: TaloxNode = {
	id: "stable-submit",
	role: "button",
	name: "Submit",
	boundingBox: { x: 10, y: 20, width: 100, height: 40 },
};

describe("diffPageState bounding-box changes", () => {
	it("reports movement or resize of a stable node", () => {
		const prev = pageState(baseNode);
		const curr = pageState({
			...baseNode,
			boundingBox: { x: 16, y: 24, width: 120, height: 44 },
		});

		const diff = diffPageState(prev, curr);

		expect(diff.nodesChanged).toEqual([
			{
				id: "stable-submit",
				field: "boundingBox",
				prev: JSON.stringify(baseNode.boundingBox),
				curr: JSON.stringify(curr.nodes[0]!.boundingBox),
			},
		]);
	});

	it("does not report identical bounding boxes", () => {
		const prev = pageState(baseNode);
		const curr = pageState({ ...baseNode, boundingBox: { ...baseNode.boundingBox } });

		const diff = diffPageState(prev, curr);

		expect(diff.nodesChanged).toEqual([]);
	});
});
