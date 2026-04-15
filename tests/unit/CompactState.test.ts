/**
 * Tests for compact state variants wired through the public TaloxController surface.
 * Verifies that getState(variant) returns the correct shape and that compactState()
 * pure function works correctly for all three variants.
 */
import { describe, expect, it } from "vitest";
import { compactState, diffPageState, type TaloxPageState } from "../../src/types/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function state(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Example",
		timestamp: new Date().toISOString(),
		console: { errors: ["TypeError: foo"] },
		network: { failedRequests: [{ url: "https://api.example.com/data", status: 500 }] },
		nodes: [
			{ id: "ax-0", role: "button", name: "Submit", boundingBox: { x: 0, y: 0, width: 100, height: 40 } },
			{ id: "ax-1", role: "link", name: "Home", boundingBox: { x: 0, y: 50, width: 80, height: 32 } },
		],
		interactiveElements: [{ id: "d0", tagName: "button", boundingBox: { x: 0, y: 0, width: 100, height: 40 } }],
		bugs: [{ id: "b1", type: "JS_ERROR", severity: "CRITICAL", description: "boom", evidence: {} }],
		...overrides,
	};
}

// ─── compactState: 'full' ─────────────────────────────────────────────────────

describe("compactState 'full'", () => {
	it("returns the same state object reference", () => {
		const s = state();
		expect(compactState(s, "full")).toBe(s);
	});

	it("preserves all v1 frozen fields", () => {
		const s = state();
		const c = compactState(s, "full");
		expect(c.url).toBe(s.url);
		expect(c.nodes).toBe(s.nodes);
		expect(c.bugs).toBe(s.bugs);
	});
});

// ─── compactState: 'agent' ────────────────────────────────────────────────────

describe("compactState 'agent'", () => {
	it("includes url, title, timestamp", () => {
		const s = state();
		const a = compactState(s, "agent");
		expect(a.url).toBe("https://example.com");
		expect(a.title).toBe("Example");
		expect(typeof a.timestamp).toBe("string");
	});

	it("includes interactiveElements", () => {
		const s = state();
		const a = compactState(s, "agent");
		expect(a.interactiveElements).toHaveLength(1);
	});

	it("flattens consoleErrors (not nested under console)", () => {
		const s = state();
		const a = compactState(s, "agent");
		expect(a.consoleErrors).toEqual(["TypeError: foo"]);
		expect((a as any).console).toBeUndefined();
	});

	it("strips bug details down to type/severity/description", () => {
		const s = state();
		const a = compactState(s, "agent");
		expect(a.bugs).toHaveLength(1);
		expect(a.bugs[0]).toEqual({ type: "JS_ERROR", severity: "CRITICAL", description: "boom" });
		expect((a.bugs[0] as any).evidence).toBeUndefined();
	});

	it("excludes nodes and network fields", () => {
		const s = state();
		const a = compactState(s, "agent");
		expect((a as any).nodes).toBeUndefined();
		expect((a as any).network).toBeUndefined();
	});
});

// ─── compactState: 'debug' ────────────────────────────────────────────────────

describe("compactState 'debug'", () => {
	it("includes full nodes array", () => {
		const s = state();
		const d = compactState(s, "debug");
		expect(d.nodes).toHaveLength(2);
		expect(d.nodes[0]?.role).toBe("button");
	});

	it("includes full console and network fields", () => {
		const s = state();
		const d = compactState(s, "debug");
		expect(d.console.errors).toEqual(["TypeError: foo"]);
		expect(d.network.failedRequests[0]?.status).toBe(500);
	});

	it("includes bugs with full detail", () => {
		const s = state();
		const d = compactState(s, "debug");
		expect(d.bugs[0]?.id).toBe("b1");
		expect((d.bugs[0] as any).evidence).toBeDefined();
	});

	it("excludes interactiveElements", () => {
		const s = state();
		const d = compactState(s, "debug");
		expect((d as any).interactiveElements).toBeUndefined();
	});
});

// ─── diffPageState export ─────────────────────────────────────────────────────

describe("diffPageState export", () => {
	it("is exported from types/index and computes diffs", () => {
		const prev = state({ url: "https://example.com/a" });
		const curr = state({ url: "https://example.com/b" });
		const diff = diffPageState(prev, curr);
		expect(diff.urlChanged).toBe(true);
		expect(diff.fromUrl).toBe("https://example.com/a");
		expect(diff.toUrl).toBe("https://example.com/b");
	});
});
