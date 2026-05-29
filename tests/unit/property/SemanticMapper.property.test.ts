/**
 * Property-based tests for SemanticMapper using fast-check.
 * Tests invariants for mapNode, mapNodes, filterByType, filterInteractive,
 * sortByPosition, and groupByType with arbitrary inputs.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SemanticEntity, SemanticEntityType } from "../../../src/core/SemanticMapper.js";
import { SemanticMapper } from "../../../src/core/SemanticMapper.js";
import type { TaloxNode } from "../../../src/types/index.js";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const boundingBoxArb = fc.record({
	x: fc.float({ noNaN: true, noDefaultInfinity: true }),
	y: fc.float({ noNaN: true, noDefaultInfinity: true }),
	width: fc.float({ min: Math.fround(0.001), noNaN: true, noDefaultInfinity: true }),
	height: fc.float({ min: Math.fround(0.001), noNaN: true, noDefaultInfinity: true }),
});

const roleArb = fc
	.string({ minLength: 1, maxLength: 20 })
	.filter((r) => r !== "__proto__" && r !== "constructor" && r !== "prototype");

const taloxNodeArb: fc.Arbitrary<TaloxNode> = fc.record({
	id: fc.string({ minLength: 1 }),
	role: roleArb,
	name: fc.string(),
	boundingBox: boundingBoxArb,
});

const fullTaloxNodeArb: fc.Arbitrary<TaloxNode> = fc.record({
	id: fc.string({ minLength: 1 }),
	role: roleArb,
	name: fc.string(),
	description: fc.option(fc.string(), { nil: undefined }),
	boundingBox: boundingBoxArb,
	attributes: fc.option(fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.boolean())), { nil: undefined }),
});

const semanticEntityTypeArb: fc.Arbitrary<SemanticEntityType> = fc.constantFrom(
	"navigation",
	"form",
	"input",
	"button",
	"link",
	"article",
	"heading",
	"image",
	"list",
	"listItem",
	"dialog",
	"toolbar",
	"menu",
	"menuItem",
	"checkbox",
	"radio",
	"combobox",
	"search",
	"footer",
	"header",
	"main",
	"aside",
	"section",
	"unknown",
);

const urlArb = fc.option(fc.webUrl(), { nil: undefined });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SemanticMapper property tests", () => {
	const mapper = new SemanticMapper();

	// ── mapNode preserves id, role, name, boundingBox ──────────────────────

	it("mapNode preserves id, role, name, and boundingBox from the input node", () => {
		fc.assert(
			fc.property(fullTaloxNodeArb, urlArb, (node, url) => {
				const entity = mapper.mapNode(node, url);
				expect(entity.id).toBe(node.id);
				expect(entity.role).toBe(node.role);
				expect(entity.name).toBe(node.name);
				expect(entity.boundingBox).toEqual(node.boundingBox);
			}),
		);
	});

	// ── mapNode always returns confidence in [0, 1] ────────────────────────

	it("mapNode always returns confidence in [0, 1]", () => {
		fc.assert(
			fc.property(fullTaloxNodeArb, urlArb, (node, url) => {
				const entity = mapper.mapNode(node, url);
				expect(entity.confidence).toBeGreaterThanOrEqual(0);
				expect(entity.confidence).toBeLessThanOrEqual(1);
			}),
		);
	});

	// ── mapNode always returns non-empty label ─────────────────────────────

	it("mapNode always returns a non-empty label for nodes with at least one alphanumeric character in name or known role", () => {
		// Filter to nodes where generateLabel will always produce something:
		// either name has alpha chars, or role is recognized, or attributes provide a fallback
		const validNodeArb = fullTaloxNodeArb.filter((n) => {
			const hasAlphaName = /[a-z0-9]/i.test(n.name);
			const hasTestId = n.attributes?.["data-testid"];
			const hasAriaLabel = n.attributes?.["aria-label"];
			const hasPlaceholder = n.attributes?.["placeholder"];
			return hasAlphaName || hasTestId || hasAriaLabel || hasPlaceholder;
		});

		fc.assert(
			fc.property(validNodeArb, urlArb, (node, url) => {
				const entity = mapper.mapNode(node, url);
				expect(entity.label.length).toBeGreaterThan(0);
			}),
		);
	});

	// ── mapNode always returns a valid type ─────────────────────────────────

	it("mapNode always returns a valid SemanticEntityType", () => {
		const validTypes = new Set<SemanticEntityType>([
			"navigation",
			"form",
			"input",
			"button",
			"link",
			"article",
			"heading",
			"image",
			"list",
			"listItem",
			"dialog",
			"toolbar",
			"menu",
			"menuItem",
			"checkbox",
			"radio",
			"combobox",
			"search",
			"footer",
			"header",
			"main",
			"aside",
			"section",
			"unknown",
		]);

		fc.assert(
			fc.property(fullTaloxNodeArb, urlArb, (node, url) => {
				const entity = mapper.mapNode(node, url);
				expect(validTypes.has(entity.type)).toBe(true);
			}),
		);
	});

	// ── mapNodes length equals input length ────────────────────────────────

	it("mapNodes output length equals input length", () => {
		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 0, maxLength: 50 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				expect(entities.length).toBe(nodes.length);
			}),
		);
	});

	// ── mapNodes[i] corresponds to nodes[i] ────────────────────────────────

	it("mapNodes[i].id === nodes[i].id for every index", () => {
		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 1, maxLength: 20 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				for (let i = 0; i < nodes.length; i++) {
					expect(entities[i]!.id).toBe(nodes[i]!.id);
				}
			}),
		);
	});

	// ── filterByType returns subset where every entity.type ∈ types ────────

	it("filterByType returns only entities whose type is in the provided types array", () => {
		fc.assert(
			fc.property(
				fc.array(fullTaloxNodeArb, { minLength: 0, maxLength: 30 }),
				urlArb,
				fc.array(semanticEntityTypeArb, { minLength: 1, maxLength: 10 }),
				(nodes, url, types) => {
					const entities = mapper.mapNodes(nodes, url);
					const filtered = mapper.filterByType(entities, types);
					for (const entity of filtered) {
						expect(types).toContain(entity.type);
					}
				},
			),
		);
	});

	it("filterByType result is a subset of the input", () => {
		fc.assert(
			fc.property(
				fc.array(fullTaloxNodeArb, { minLength: 0, maxLength: 30 }),
				urlArb,
				fc.array(semanticEntityTypeArb, { minLength: 1, maxLength: 10 }),
				(nodes, url, types) => {
					const entities = mapper.mapNodes(nodes, url);
					const filtered = mapper.filterByType(entities, types);
					expect(filtered.length).toBeLessThanOrEqual(entities.length);
					const inputIds = new Set(entities.map((e) => e.id));
					for (const entity of filtered) {
						expect(inputIds.has(entity.id)).toBe(true);
					}
				},
			),
		);
	});

	// ── filterInteractive returns only entities with interactive types ──────

	it("filterInteractive returns only entities with interactive semantic types", () => {
		const interactiveTypes: SemanticEntityType[] = [
			"button",
			"link",
			"input",
			"search",
			"checkbox",
			"radio",
			"combobox",
			"menuItem",
		];

		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 0, maxLength: 30 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				const interactive = mapper.filterInteractive(entities);
				for (const entity of interactive) {
					expect(interactiveTypes).toContain(entity.type);
				}
			}),
		);
	});

	it("filterInteractive result is a subset of the input", () => {
		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 0, maxLength: 30 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				const interactive = mapper.filterInteractive(entities);
				expect(interactive.length).toBeLessThanOrEqual(entities.length);
			}),
		);
	});

	// ── sortByPosition returns same length (permutation) ────────────────────

	it("sortByPosition returns a permutation of the input (same length, same ids)", () => {
		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 0, maxLength: 30 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				const sorted = mapper.sortByPosition(entities);
				expect(sorted.length).toBe(entities.length);

				const originalIds = entities.map((e) => e.id).sort();
				const sortedIds = sorted.map((e) => e.id).sort();
				expect(sortedIds).toEqual(originalIds);
			}),
		);
	});

	it("sortByPosition does not modify the original array", () => {
		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 1, maxLength: 20 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				const originalIds = entities.map((e) => e.id);
				mapper.sortByPosition(entities);
				expect(entities.map((e) => e.id)).toEqual(originalIds);
			}),
		);
	});

	// ── groupByType partition covers all input entities ─────────────────────

	it("groupByType partition covers all input entities exactly once", () => {
		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 0, maxLength: 30 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				const groups = mapper.groupByType(entities);

				// Every entity appears exactly once across all groups
				const allGrouped: SemanticEntity[] = [];
				for (const entry of Array.from(groups.entries())) {
					allGrouped.push(...entry[1]);
				}
				expect(allGrouped.length).toBe(entities.length);

				// Verify ids match
				const inputIds = new Set(entities.map((e) => e.id));
				for (const grouped of allGrouped) {
					expect(inputIds.has(grouped.id)).toBe(true);
				}

				// Every entity in a group matches the group's type
				for (const [type, group] of Array.from(groups.entries())) {
					for (const entity of group) {
						expect(entity.type).toBe(type);
					}
				}
			}),
		);
	});

	it("groupByType group keys cover all types present in input", () => {
		fc.assert(
			fc.property(fc.array(fullTaloxNodeArb, { minLength: 1, maxLength: 30 }), urlArb, (nodes, url) => {
				const entities = mapper.mapNodes(nodes, url);
				const groups = mapper.groupByType(entities);

				const inputTypes = new Set(entities.map((e) => e.type));
				const groupTypes = new Set(groups.keys());
				expect(groupTypes).toEqual(inputTypes);
			}),
		);
	});
});
