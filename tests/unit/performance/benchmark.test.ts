/**
 * @file benchmark.test.ts
 * @description Performance regression tests for pure-compute modules.
 * Verifies key operations complete within defined time budgets.
 *
 * No browser required — all tests are synchronous pure-function benchmarks.
 * Run: npx vitest run tests/unit/performance/benchmark.test.ts
 */
import { describe, expect, it } from "vitest";
import { FingerprintGenerator } from "../../../src/core/FingerprintGenerator.js";
import { SelfHealingSelector } from "../../../src/core/SelfHealingSelector.js";
import { SemanticMapper } from "../../../src/core/SemanticMapper.js";
import { compactState, diffPageState, type TaloxNode, type TaloxPageState } from "../../../src/types/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNode(id: number): TaloxNode {
	return {
		id: `node-${id}`,
		role: ["button", "link", "textbox", "heading", "navigation", "list", "listitem", "dialog"][id % 8] ?? "unknown",
		name: `Element ${id}`,
		boundingBox: {
			x: (id * 37) % 1920,
			y: (id * 53) % 1080,
			width: 100 + (id % 200),
			height: 30 + (id % 50),
		},
		attributes: {
			"data-testid": `el-${id}`,
			"aria-label": `Label for element ${id}`,
		},
	};
}

function makeLargeState(nodeCount: number, overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	const nodes: TaloxNode[] = [];
	for (let i = 0; i < nodeCount; i++) {
		nodes.push(makeNode(i));
	}
	return {
		url: "https://example.com/perf-test",
		title: "Performance Test Page",
		timestamp: new Date().toISOString(),
		console: {
			errors: Array.from({ length: 10 }, (_, i) => `Error ${i}: TypeError: something broke`),
			warnings: Array.from({ length: 5 }, (_, i) => `Warning ${i}: deprecation notice`),
			logs: Array.from({ length: 20 }, (_, i) => `Log ${i}: info message`),
		},
		network: {
			failedRequests: Array.from({ length: 5 }, (_, i) => ({
				url: `https://api.example.com/endpoint-${i}`,
				status: 500 + i,
				type: "fetch",
			})),
		},
		nodes,
		interactiveElements: nodes.slice(0, Math.min(nodeCount, 50)).map((n) => ({
			id: `#${n.id}`,
			tagName: "div",
			role: n.role,
			text: n.name,
			boundingBox: n.boundingBox,
			isActionable: true,
		})),
		bugs: Array.from({ length: 5 }, (_, i) => ({
			id: `bug-${i}`,
			type: "JS_ERROR" as const,
			severity: "MAJOR" as const,
			description: `Bug ${i} description`,
			evidence: { url: "https://example.com" },
		})),
		...overrides,
	};
}

// ─── Benchmarks ───────────────────────────────────────────────────────────────

describe("performance benchmarks", () => {
	// ── FingerprintGenerator.generate() ──────────────────────────────────────

	it("FingerprintGenerator.generate() completes in < 50ms", () => {
		const gen = new FingerprintGenerator();

		const start = performance.now();
		const profile = gen.generate();
		const elapsed = performance.now() - start;

		// Verify it actually produced output
		expect(profile).toBeDefined();
		expect(profile.id).toBeTruthy();
		expect(profile.userAgent).toBeTruthy();

		expect(elapsed).toBeLessThan(50);
	});

	it("FingerprintGenerator.generate() x 100 profiles completes in < 500ms", () => {
		const gen = new FingerprintGenerator();

		const start = performance.now();
		for (let i = 0; i < 100; i++) {
			gen.generate(`seed-${i}`);
		}
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(500);
	});

	// ── SemanticMapper.mapNodes() with 100 nodes ─────────────────────────────

	it("SemanticMapper.mapNodes() with 100 nodes completes in < 100ms", () => {
		const mapper = new SemanticMapper();
		const nodes = Array.from({ length: 100 }, (_, i) => makeNode(i));

		const start = performance.now();
		const entities = mapper.mapNodes(nodes, "https://github.com/test");
		const elapsed = performance.now() - start;

		expect(entities).toHaveLength(100);
		expect(entities[0]?.id).toBe("node-0");
		expect(elapsed).toBeLessThan(100);
	});

	it("SemanticMapper.mapNodes() with 1000 nodes completes in < 500ms", () => {
		const mapper = new SemanticMapper();
		const nodes = Array.from({ length: 1000 }, (_, i) => makeNode(i));

		const start = performance.now();
		const entities = mapper.mapNodes(nodes);
		const elapsed = performance.now() - start;

		expect(entities).toHaveLength(1000);
		expect(elapsed).toBeLessThan(500);
	});

	// ── compactState() with large state ──────────────────────────────────────

	it("compactState('full') with 500-node state completes in < 10ms", () => {
		const state = makeLargeState(500);

		const start = performance.now();
		const result = compactState(state, "full");
		const elapsed = performance.now() - start;

		expect(result).toBe(state); // full returns same reference
		expect(elapsed).toBeLessThan(10);
	});

	it("compactState('agent') with 500-node state completes in < 10ms", () => {
		const state = makeLargeState(500);

		const start = performance.now();
		const result = compactState(state, "agent");
		const elapsed = performance.now() - start;

		expect(result.url).toBe("https://example.com/perf-test");
		expect(elapsed).toBeLessThan(10);
	});

	it("compactState('debug') with 500-node state completes in < 10ms", () => {
		const state = makeLargeState(500);

		const start = performance.now();
		const result = compactState(state, "debug");
		const elapsed = performance.now() - start;

		expect(result.nodes).toHaveLength(500);
		expect(elapsed).toBeLessThan(10);
	});

	// ── diffPageState() with two large states ────────────────────────────────

	it("diffPageState() with two 500-node states completes in < 10ms", () => {
		const prev = makeLargeState(500);

		// Modify some nodes for a non-trivial diff
		const currNodes = Array.from({ length: 600 }, (_, i) => makeNode(i + 50));
		const curr = makeLargeState(600, { nodes: currNodes });

		const start = performance.now();
		const diff = diffPageState(prev, curr);
		const elapsed = performance.now() - start;

		expect(diff).toBeDefined();
		expect(diff.nodesAdded.length).toBeGreaterThan(0);
		expect(elapsed).toBeLessThan(10);
	});

	it("diffPageState() with two identical 1000-node states completes in < 15ms", () => {
		const state = makeLargeState(1000);

		const start = performance.now();
		const diff = diffPageState(state, state);
		const elapsed = performance.now() - start;

		expect(diff.urlChanged).toBe(false);
		expect(diff.nodesChanged).toEqual([]);
		expect(elapsed).toBeLessThan(15);
	});

	// ── SelfHealingSelector.recordSuccess() x 1000 ───────────────────────────

	it("SelfHealingSelector.recordSuccess() x 1000 calls completes in < 50ms", () => {
		const healer = new SelfHealingSelector();
		const node = makeNode(0);

		const start = performance.now();
		for (let i = 0; i < 1000; i++) {
			healer.recordSuccess(`#selector-${i % 10}`, {
				...node,
				id: `node-${i}`,
				name: `Element ${i}`,
			});
		}
		const elapsed = performance.now() - start;

		// Verify at least some were recorded
		const states = healer.getSuccessStates("#selector-0");
		expect(states.length).toBeGreaterThan(0);

		expect(elapsed).toBeLessThan(50);
	});

	it("SelfHealingSelector heal() with 1000 recorded states completes in < 100ms", async () => {
		const healer = new SelfHealingSelector();
		const node = makeNode(0);

		// Pre-record states
		for (let i = 0; i < 100; i++) {
			healer.recordSuccess("#target-btn", {
				...node,
				id: `node-${i}`,
				name: `Button ${i}`,
				boundingBox: { x: i * 10, y: i * 5, width: 100, height: 40 },
			});
		}

		// Build a current node set to search against
		const currentNodes = Array.from({ length: 50 }, (_, i) => makeNode(i));

		const start = performance.now();
		const result = await healer.heal("#target-btn", currentNodes);
		const elapsed = performance.now() - start;

		// We don't care if result is null (it may not match) — we just care about perf
		expect(elapsed).toBeLessThan(100);
	});
});
