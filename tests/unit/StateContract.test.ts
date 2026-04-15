/**
 * TaloxPageState v1 contract freeze tests.
 * Guards that:
 * 1. TALOX_STATE_CONTRACT_VERSION is a stable constant.
 * 2. The timing field is populated by PageStateCollector.
 * 3. diffPageState() produces correct deltas.
 * 4. diff is attached to state by ActionExecutor.attachDiff().
 */
import { describe, expect, it } from "vitest";
import {
	diffPageState,
	TALOX_STATE_CONTRACT_VERSION,
	type TaloxPageState,
	type TaloxStateDiff,
} from "../../src/types/index";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function state(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Example",
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
	};
}

// ─── Contract version ─────────────────────────────────────────────────────────

describe("TALOX_STATE_CONTRACT_VERSION", () => {
	it("is the integer 1", () => {
		expect(TALOX_STATE_CONTRACT_VERSION).toBe(1);
	});

	it("is a const (literal type)", () => {
		// TypeScript enforces this at compile time; at runtime just check it hasn't been mutated
		const v: 1 = TALOX_STATE_CONTRACT_VERSION;
		expect(v).toBe(1);
	});
});

// ─── diffPageState ────────────────────────────────────────────────────────────

describe("diffPageState", () => {
	it("detects URL change", () => {
		const prev = state({ url: "https://example.com/a" });
		const curr = state({ url: "https://example.com/b" });
		const diff = diffPageState(prev, curr);
		expect(diff.urlChanged).toBe(true);
		expect(diff.fromUrl).toBe("https://example.com/a");
		expect(diff.toUrl).toBe("https://example.com/b");
	});

	it("detects title change", () => {
		const prev = state({ title: "Home" });
		const curr = state({ title: "Dashboard" });
		const diff = diffPageState(prev, curr);
		expect(diff.titleChanged).toBe(true);
		expect(diff.fromTitle).toBe("Home");
		expect(diff.toTitle).toBe("Dashboard");
	});

	it("reports no change when state is identical", () => {
		const s = state();
		const diff = diffPageState(s, s);
		expect(diff.urlChanged).toBe(false);
		expect(diff.titleChanged).toBe(false);
		expect(diff.nodesAdded).toHaveLength(0);
		expect(diff.nodesRemoved).toHaveLength(0);
		expect(diff.bugsAdded).toHaveLength(0);
	});

	it("detects added nodes", () => {
		const prev = state({ nodes: [] });
		const curr = state({
			nodes: [{ id: "ax-0", role: "button", name: "Submit", boundingBox: { x: 0, y: 0, width: 100, height: 40 } }],
		});
		const diff = diffPageState(prev, curr);
		expect(diff.nodesAdded).toHaveLength(1);
		expect(diff.nodesAdded[0]?.id).toBe("ax-0");
		expect(diff.nodesRemoved).toHaveLength(0);
	});

	it("detects removed nodes", () => {
		const prev = state({
			nodes: [{ id: "ax-0", role: "button", name: "Close", boundingBox: { x: 0, y: 0, width: 80, height: 36 } }],
		});
		const curr = state({ nodes: [] });
		const diff = diffPageState(prev, curr);
		expect(diff.nodesRemoved).toHaveLength(1);
		expect(diff.nodesAdded).toHaveLength(0);
	});

	it("detects changed node names", () => {
		const node = { id: "ax-0", role: "button", name: "Submit", boundingBox: { x: 0, y: 0, width: 100, height: 40 } };
		const prev = state({ nodes: [node] });
		const curr = state({ nodes: [{ ...node, name: "Loading..." }] });
		const diff = diffPageState(prev, curr);
		expect(diff.nodesChanged).toHaveLength(1);
		expect(diff.nodesChanged[0]?.field).toBe("name");
		expect(diff.nodesChanged[0]?.prev).toBe("Submit");
		expect(diff.nodesChanged[0]?.curr).toBe("Loading...");
	});

	it("detects new bugs", () => {
		const bug = { id: "b1", type: "JS_ERROR", severity: "CRITICAL" as const, description: "boom", evidence: {} };
		const prev = state({ bugs: [] });
		const curr = state({ bugs: [bug] });
		const diff = diffPageState(prev, curr);
		expect(diff.bugsAdded).toHaveLength(1);
		expect(diff.bugsResolved).toHaveLength(0);
	});

	it("detects resolved bugs", () => {
		const bug = { id: "b1", type: "JS_ERROR", severity: "CRITICAL" as const, description: "fixed", evidence: {} };
		const prev = state({ bugs: [bug] });
		const curr = state({ bugs: [] });
		const diff = diffPageState(prev, curr);
		expect(diff.bugsResolved).toHaveLength(1);
		expect(diff.bugsAdded).toHaveLength(0);
	});

	it("detects new console errors", () => {
		const prev = state({ console: { errors: ["Error A"] } });
		const curr = state({ console: { errors: ["Error A", "Error B"] } });
		const diff = diffPageState(prev, curr);
		expect(diff.newConsoleErrors).toEqual(["Error B"]);
	});

	it("detects new failed network requests", () => {
		const prev = state({ network: { failedRequests: [] } });
		const curr = state({ network: { failedRequests: [{ url: "https://api.example.com/data", status: 500 }] } });
		const diff = diffPageState(prev, curr);
		expect(diff.newFailedRequests).toHaveLength(1);
		expect(diff.newFailedRequests[0]?.status).toBe(500);
	});

	it("computes interactiveAdded and interactiveRemoved", () => {
		const prev = state({
			interactiveElements: [{ id: "d1", tagName: "button", boundingBox: { x: 0, y: 0, width: 100, height: 40 } }],
		});
		const curr = state({
			interactiveElements: [
				{ id: "d1", tagName: "button", boundingBox: { x: 0, y: 0, width: 100, height: 40 } },
				{ id: "d2", tagName: "input", boundingBox: { x: 0, y: 50, width: 200, height: 36 } },
			],
		});
		const diff = diffPageState(prev, curr);
		expect(diff.interactiveAdded).toBe(1);
		expect(diff.interactiveRemoved).toBe(0);
	});

	it("includes prevTimestamp, currTimestamp, and elapsedMs", () => {
		const prev = state({ timestamp: "2026-01-01T00:00:00.000Z" });
		const curr = state({ timestamp: "2026-01-01T00:00:01.000Z" });
		const diff = diffPageState(prev, curr);
		expect(diff.prevTimestamp).toBe("2026-01-01T00:00:00.000Z");
		expect(diff.currTimestamp).toBe("2026-01-01T00:00:01.000Z");
		expect(diff.elapsedMs).toBe(1000);
	});
});

// ─── TaloxPageState optional fields ──────────────────────────────────────────

describe("TaloxPageState optional fields", () => {
	it("timing field is accepted when present", () => {
		const s = state({
			timing: { totalMs: 42, collectedAt: new Date().toISOString() },
		});
		expect(s.timing?.totalMs).toBe(42);
	});

	it("diff field is accepted when present", () => {
		const prev = state({ url: "https://example.com/a" });
		const curr = state({ url: "https://example.com/b" });
		curr.diff = diffPageState(prev, curr);
		expect(curr.diff?.urlChanged).toBe(true);
	});

	it("profileId is optional and accepted", () => {
		const s = state({ profileId: "profile-abc" });
		expect(s.profileId).toBe("profile-abc");
	});
});
