/**
 * Property-based tests for SelfHealingSelector using fast-check.
 * Tests invariants with arbitrary inputs to ensure correctness under fuzz.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SelfHealingSelector } from "../../../src/core/SelfHealingSelector.js";
import type { TaloxNode } from "../../../src/types/index.js";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const boundingBoxArb = fc.record({
	x: fc.float({ noNaN: true, noDefaultInfinity: true }),
	y: fc.float({ noNaN: true, noDefaultInfinity: true }),
	width: fc.float({ min: Math.fround(0.001), noNaN: true, noDefaultInfinity: true }),
	height: fc.float({ min: Math.fround(0.001), noNaN: true, noDefaultInfinity: true }),
});

const taloxNodeArb: fc.Arbitrary<TaloxNode> = fc.record({
	id: fc.string({ minLength: 1 }),
	role: fc.string({ minLength: 1 }),
	name: fc.string(),
	boundingBox: boundingBoxArb,
});

/** Node with optional fields filled in for richer testing. */
const fullTaloxNodeArb: fc.Arbitrary<TaloxNode> = fc.record({
	id: fc.string({ minLength: 1 }),
	role: fc.string({ minLength: 1 }),
	name: fc.string(),
	description: fc.option(fc.string(), { nil: undefined }),
	boundingBox: boundingBoxArb,
	attributes: fc.option(fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.boolean())), {
		nil: undefined,
	}),
});

const selectorStringArb = fc.string({ minLength: 1, maxLength: 20 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a node with deterministic bounding box for position-match tests. */
function makeNode(overrides: Partial<TaloxNode> = {}): TaloxNode {
	return {
		id: "node-1",
		role: "button",
		name: "Submit",
		boundingBox: { x: 100, y: 200, width: 80, height: 40 },
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SelfHealingSelector property tests", () => {
	// ── State cap invariant ─────────────────────────────────────────────────

	it("getSuccessStates(selector).length <= 5 for any sequence of recordSuccess calls with the same selector", () => {
		fc.assert(
			fc.property(selectorStringArb, fc.array(taloxNodeArb, { minLength: 0, maxLength: 50 }), (selector, nodes) => {
				const shs = new SelfHealingSelector();
				for (const node of nodes) {
					shs.recordSuccess(selector, node);
				}
				const states = shs.getSuccessStates(selector);
				expect(states.length).toBeLessThanOrEqual(5);
			}),
		);
	});

	// ── Snapshot cap invariant ──────────────────────────────────────────────

	it("recordSnapshot stores at most 10 snapshots (observable via heal behavior)", () => {
		fc.assert(
			fc.property(
				fc.array(fc.array(taloxNodeArb, { minLength: 1, maxLength: 5 }), {
					minLength: 0,
					maxLength: 30,
				}),
				(snapshots) => {
					const shs = new SelfHealingSelector();
					for (const snap of snapshots) {
						shs.recordSnapshot(snap);
					}
					// We can't directly inspect the internal array, but the contract
					// is that recordSnapshot caps at 10. Verify that calling it many
					// times doesn't throw and the instance remains usable.
					const node = makeNode({ id: "test", role: "button", name: "Test" });
					shs.recordSuccess("sel", node);
					// Should not throw — basic liveness check
					expect(() => shs.getSuccessStates("sel")).not.toThrow();
					expect(shs.getSuccessStates("sel").length).toBeLessThanOrEqual(5);
				},
			),
		);
	});

	// ── heal() returns null for never-recorded selectors ────────────────────

	it("heal() returns null for selectors that were never recorded", () => {
		fc.assert(
			fc.asyncProperty(
				selectorStringArb,
				fc.array(taloxNodeArb, { minLength: 0, maxLength: 10 }),
				async (selector, currentNodes) => {
					const shs = new SelfHealingSelector();
					const result = await shs.heal(selector, currentNodes);
					expect(result).toBeNull();
				},
			),
		);
	});

	// ── heal() returns confidence in [0, 1] when non-null ───────────────────

	it("heal() returns confidence in [0, 1] when result is non-null", () => {
		fc.assert(
			fc.asyncProperty(
				selectorStringArb,
				fullTaloxNodeArb,
				fc.array(fullTaloxNodeArb, { minLength: 1, maxLength: 10 }),
				async (selector, recordedNode, currentNodes) => {
					const shs = new SelfHealingSelector();
					shs.recordSuccess(selector, recordedNode);
					const result = await shs.heal(selector, currentNodes);
					if (result !== null) {
						expect(result.confidence).toBeGreaterThanOrEqual(0);
						expect(result.confidence).toBeLessThanOrEqual(1);
					}
				},
			),
		);
	});

	// ── heal() matchedNode is always a member of currentNodes ───────────────

	it("heal() matchedNode is always a member of currentNodes", () => {
		fc.assert(
			fc.asyncProperty(
				selectorStringArb,
				fullTaloxNodeArb,
				fc.array(fullTaloxNodeArb, { minLength: 1, maxLength: 10 }),
				async (selector, recordedNode, currentNodes) => {
					const shs = new SelfHealingSelector();
					shs.recordSuccess(selector, recordedNode);
					const result = await shs.heal(selector, currentNodes);
					if (result !== null) {
						const currentIds = currentNodes.map((n) => n.id);
						expect(currentIds).toContain(result.matchedNode.id);
					}
				},
			),
		);
	});

	// ── String similarity is symmetric ──────────────────────────────────────
	// Test via public API: record name-A → heal against name-B should yield
	// the same confidence as record name-B → heal against name-A,
	// when only name-similarity strategy is enabled.

	it("name similarity is symmetric through the public API", () => {
		fc.assert(
			fc.asyncProperty(
				fc.string({ minLength: 2, maxLength: 30 }),
				fc.string({ minLength: 2, maxLength: 30 }),
				fc.float({ min: -1000, max: 1000, noNaN: true }),
				fc.float({ min: -1000, max: 1000, noNaN: true }),
				async (nameA, nameB, x1, x2) => {
					// Use names that are non-empty after trim+toLowerCase
					if (!nameA.trim() || !nameB.trim()) return;

					const nameOnlyOptions = {
						enableRoleMatch: false,
						enableNameSimilarity: true,
						enablePositionMatch: false,
						enableContextMatch: false,
						nameSimilarityThreshold: 0,
					};

					const box1 = { x: x1, y: 100, width: 80, height: 40 };
					const box2 = { x: x2, y: 200, width: 80, height: 40 };

					// Direction 1: record A, heal against B
					const shs1 = new SelfHealingSelector(nameOnlyOptions);
					shs1.recordSuccess("sel", makeNode({ id: "a", name: nameA, boundingBox: box1 }));
					const r1 = await shs1.heal("sel", [makeNode({ id: "b", name: nameB, boundingBox: box2 })]);

					// Direction 2: record B, heal against A
					const shs2 = new SelfHealingSelector(nameOnlyOptions);
					shs2.recordSuccess("sel", makeNode({ id: "b", name: nameB, boundingBox: box2 }));
					const r2 = await shs2.heal("sel", [makeNode({ id: "a", name: nameA, boundingBox: box1 })]);

					// If both produce results, confidences must be equal (symmetry)
					if (r1 !== null && r2 !== null) {
						expect(r1.confidence).toBeCloseTo(r2.confidence, 10);
					}
					// If one is null and the other isn't, that could only happen
					// if one combined confidence < 0.3 and other >= 0.3, but
					// since they're equal, both must be null or both non-null.
					if (r1 === null && r2 !== null) {
						expect(r2.confidence).toBeLessThan(0.3);
					}
					if (r2 === null && r1 !== null) {
						expect(r1.confidence).toBeLessThan(0.3);
					}
				},
			),
		);
	});

	// ── Multiple recordSuccess calls with same selector still cap at 5 ──────

	it("even after interleaved recordSuccess and recordSnapshot, state cap holds", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.oneof(
						// Either record a success
						fc.record({ type: fc.constant("success"), node: taloxNodeArb }) as fc.Arbitrary<{
							type: "success";
							node: TaloxNode;
						}>,
						// Or record a snapshot
						fc.record({
							type: fc.constant("snapshot"),
							nodes: fc.array(taloxNodeArb, { minLength: 1, maxLength: 5 }),
						}) as fc.Arbitrary<{ type: "snapshot"; nodes: TaloxNode[] }>,
					),
					{ minLength: 1, maxLength: 40 },
				),
				selectorStringArb,
				(actions, selector) => {
					const shs = new SelfHealingSelector();
					for (const action of actions) {
						if (action.type === "success") {
							shs.recordSuccess(selector, action.node);
						} else {
							shs.recordSnapshot(action.nodes);
						}
					}
					expect(shs.getSuccessStates(selector).length).toBeLessThanOrEqual(5);
				},
			),
		);
	});

	// ── clearHistory resets everything ──────────────────────────────────────

	it("clearHistory() causes heal to return null for previously recorded selectors", () => {
		fc.assert(
			fc.asyncProperty(
				selectorStringArb,
				taloxNodeArb,
				fc.array(taloxNodeArb, { minLength: 1, maxLength: 5 }),
				async (selector, node, currentNodes) => {
					const shs = new SelfHealingSelector();
					shs.recordSuccess(selector, node);
					shs.clearHistory();
					const result = await shs.heal(selector, currentNodes);
					expect(result).toBeNull();
					expect(shs.getSuccessStates(selector)).toEqual([]);
				},
			),
		);
	});
});
