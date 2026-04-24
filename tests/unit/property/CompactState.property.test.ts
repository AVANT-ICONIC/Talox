/**
 * Property-based tests for compactState and diffPageState using fast-check.
 * Tests structural invariants with arbitrary TaloxPageState inputs.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
	compactState,
	diffPageState,
	type TaloxPageState,
	type TaloxNode,
	type TaloxBug,
} from "../../../src/types/index.js";

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

const taloxBugArb: fc.Arbitrary<TaloxBug> = fc.record({
	id: fc.string({ minLength: 1 }),
	type: fc.string({ minLength: 1 }),
	severity: fc.constantFrom("CRITICAL", "MAJOR", "MINOR"),
	description: fc.string(),
	evidence: fc.constant({}),
});

const interactiveElementArb = fc.record({
	id: fc.string({ minLength: 1 }),
	tagName: fc.string({ minLength: 1 }),
	boundingBox: boundingBoxArb,
});

const failedRequestArb = fc.record({
	url: fc.webUrl(),
	status: fc.integer({ min: 400, max: 599 }),
});

const taloxPageStateArb: fc.Arbitrary<TaloxPageState> = fc.record({
	url: fc.webUrl(),
	title: fc.string({ minLength: 1 }),
	timestamp: fc.string({ minLength: 1 }),
	console: fc.record({
		errors: fc.array(fc.string()),
		warnings: fc.option(fc.array(fc.string()), { nil: undefined }),
		logs: fc.option(fc.array(fc.string()), { nil: undefined }),
	}),
	network: fc.record({
		failedRequests: fc.array(failedRequestArb),
		exceptions: fc.option(fc.array(fc.anything()), { nil: undefined }),
	}),
	nodes: fc.array(taloxNodeArb, { minLength: 0, maxLength: 20 }),
	interactiveElements: fc.array(interactiveElementArb, { minLength: 0, maxLength: 10 }),
	bugs: fc.array(taloxBugArb, { minLength: 0, maxLength: 10 }),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CompactState / diffPageState property tests", () => {
	// ── compactState(s, "full") returns reference-equal to s ────────────────

	it('compactState(s, "full") returns reference-equal to s', () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const result = compactState(s, "full");
				expect(result).toBe(s);
			}),
		);
	});

	// ── compactState(s, "agent") preserves url, title, timestamp ───────────

	it('compactState(s, "agent") preserves url, title, timestamp', () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const agent = compactState(s, "agent");
				expect(agent.url).toBe(s.url);
				expect(agent.title).toBe(s.title);
				expect(agent.timestamp).toBe(s.timestamp);
			}),
		);
	});

	it('compactState(s, "agent") returns interactiveElements, consoleErrors, bugs', () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const agent = compactState(s, "agent");
				expect(agent.interactiveElements).toBe(s.interactiveElements);
				expect(agent.consoleErrors).toEqual(s.console.errors);
				expect(agent.bugs).toEqual(
					s.bugs.map((b) => ({ type: b.type, severity: b.severity, description: b.description })),
				);
			}),
		);
	});

	// ── compactState(s, "debug") preserves url, title, timestamp, nodes ────

	it('compactState(s, "debug") preserves url, title, timestamp', () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const debug = compactState(s, "debug");
				expect(debug.url).toBe(s.url);
				expect(debug.title).toBe(s.title);
				expect(debug.timestamp).toBe(s.timestamp);
			}),
		);
	});

	it('compactState(s, "debug") preserves nodes reference', () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const debug = compactState(s, "debug");
				expect(debug.nodes).toBe(s.nodes);
			}),
		);
	});

	it('compactState(s, "debug") preserves console, network, bugs', () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const debug = compactState(s, "debug");
				expect(debug.console).toBe(s.console);
				expect(debug.network).toBe(s.network);
				expect(debug.bugs).toBe(s.bugs);
			}),
		);
	});

	// ── diffPageState(s, s) yields no added/removed nodes, urlChanged=false

	it("diffPageState(s, s) yields no added/removed nodes and urlChanged=false", () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const diff = diffPageState(s, s);
				expect(diff.nodesAdded).toEqual([]);
				expect(diff.nodesRemoved).toEqual([]);
				expect(diff.urlChanged).toBe(false);
				expect(diff.titleChanged).toBe(false);
				expect(diff.nodesChanged).toEqual([]);
				expect(diff.bugsAdded).toEqual([]);
				expect(diff.bugsResolved).toEqual([]);
				expect(diff.newConsoleErrors).toEqual([]);
				expect(diff.newFailedRequests).toEqual([]);
			}),
		);
	});

	it("diffPageState(s, s) fromUrl === toUrl and fromTitle === toTitle", () => {
		fc.assert(
			fc.property(taloxPageStateArb, (s) => {
				const diff = diffPageState(s, s);
				expect(diff.fromUrl).toBe(s.url);
				expect(diff.toUrl).toBe(s.url);
				expect(diff.fromTitle).toBe(s.title);
				expect(diff.toTitle).toBe(s.title);
			}),
		);
	});

	// ── diffPageState partition: nodesAdded only from curr, nodesRemoved only from prev

	it("diffPageState: every node in nodesAdded has id from curr but not prev", () => {
		fc.assert(
			fc.property(taloxPageStateArb, taloxPageStateArb, (prev, curr) => {
				const diff = diffPageState(prev, curr);
				const prevIds = new Set(prev.nodes.map((n) => n.id));
				const currIds = new Set(curr.nodes.map((n) => n.id));

				for (const node of diff.nodesAdded) {
					expect(currIds.has(node.id)).toBe(true);
					expect(prevIds.has(node.id)).toBe(false);
				}
			}),
		);
	});

	it("diffPageState: every node in nodesRemoved has id from prev but not curr", () => {
		fc.assert(
			fc.property(taloxPageStateArb, taloxPageStateArb, (prev, curr) => {
				const diff = diffPageState(prev, curr);
				const prevIds = new Set(prev.nodes.map((n) => n.id));
				const currIds = new Set(curr.nodes.map((n) => n.id));

				for (const node of diff.nodesRemoved) {
					expect(prevIds.has(node.id)).toBe(true);
					expect(currIds.has(node.id)).toBe(false);
				}
			}),
		);
	});

	// ── diffPageState url/title invariants ──────────────────────────────────

	it("diffPageState: urlChanged is true iff prev.url !== curr.url", () => {
		fc.assert(
			fc.property(taloxPageStateArb, taloxPageStateArb, (prev, curr) => {
				const diff = diffPageState(prev, curr);
				expect(diff.urlChanged).toBe(prev.url !== curr.url);
			}),
		);
	});

	it("diffPageState: titleChanged is true iff prev.title !== curr.title", () => {
		fc.assert(
			fc.property(taloxPageStateArb, taloxPageStateArb, (prev, curr) => {
				const diff = diffPageState(prev, curr);
				expect(diff.titleChanged).toBe(prev.title !== curr.title);
			}),
		);
	});

	// ── diffPageState bugs partition ────────────────────────────────────────

	it("diffPageState: bugsAdded are from curr but not prev, bugsResolved from prev but not curr", () => {
		fc.assert(
			fc.property(taloxPageStateArb, taloxPageStateArb, (prev, curr) => {
				const diff = diffPageState(prev, curr);
				const prevBugIds = new Set(prev.bugs.map((b) => b.id));
				const currBugIds = new Set(curr.bugs.map((b) => b.id));

				for (const bug of diff.bugsAdded) {
					expect(currBugIds.has(bug.id)).toBe(true);
					expect(prevBugIds.has(bug.id)).toBe(false);
				}

				for (const bug of diff.bugsResolved) {
					expect(prevBugIds.has(bug.id)).toBe(true);
					expect(currBugIds.has(bug.id)).toBe(false);
				}
			}),
		);
	});

	// ── diffPageState added+removed count <= total nodes ────────────────────

	it("diffPageState: nodesAdded.length + nodesRemoved.length <= prev.nodes.length + curr.nodes.length", () => {
		fc.assert(
			fc.property(taloxPageStateArb, taloxPageStateArb, (prev, curr) => {
				const diff = diffPageState(prev, curr);
				expect(diff.nodesAdded.length + diff.nodesRemoved.length).toBeLessThanOrEqual(
					prev.nodes.length + curr.nodes.length,
				);
			}),
		);
	});

	// ── diffPageState fromUrl/toUrl always match inputs ─────────────────────

	it("diffPageState: fromUrl === prev.url, toUrl === curr.url", () => {
		fc.assert(
			fc.property(taloxPageStateArb, taloxPageStateArb, (prev, curr) => {
				const diff = diffPageState(prev, curr);
				expect(diff.fromUrl).toBe(prev.url);
				expect(diff.toUrl).toBe(curr.url);
			}),
		);
	});
});
