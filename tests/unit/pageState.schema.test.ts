/**
 * Schema validation tests for TaloxPageState.
 *
 * These tests verify that:
 * 1. The required contract fields are present and correctly typed.
 * 2. compactState() outputs conform to their declared shapes.
 * 3. PageStateCollector.collect() returns a structurally valid state (mocked page).
 * 4. State contract invariants hold across edge cases.
 */

import { describe, expect, it, vi } from "vitest";
import { PageStateCollector } from "../../src/core/PageStateCollector";
import { compactState } from "../../src/types/index";
import {
	assertValidAgentState,
	assertValidDebugState,
	assertValidPageState,
	makeMinimalState,
	makeRichState,
} from "./helpers/pageStateHelper";

// ─── TaloxPageState contract tests ────────────────────────────────────────────

describe("TaloxPageState contract", () => {
	describe("minimal valid state", () => {
		it("passes schema validation", () => {
			assertValidPageState(makeMinimalState());
		});

		it("has correct url", () => {
			const s = makeMinimalState();
			expect(s.url).toBe("https://example.com/page");
		});

		it("has valid ISO timestamp", () => {
			const s = makeMinimalState();
			expect(new Date(s.timestamp).toISOString()).toBe(s.timestamp);
		});

		it("has empty arrays for console/network/nodes/elements/bugs", () => {
			const s = makeMinimalState();
			expect(s.console.errors).toEqual([]);
			expect(s.network.failedRequests).toEqual([]);
			expect(s.nodes).toEqual([]);
			expect(s.interactiveElements).toEqual([]);
			expect(s.bugs).toEqual([]);
		});
	});

	describe("rich valid state", () => {
		it("passes schema validation", () => {
			assertValidPageState(makeRichState());
		});

		it("captures console errors as strings", () => {
			const s = makeRichState();
			for (const e of s.console.errors) {
				expect(typeof e).toBe("string");
			}
		});

		it("captures failed requests with url+status", () => {
			const s = makeRichState();
			for (const r of s.network.failedRequests) {
				expect(typeof r.url).toBe("string");
				expect(typeof r.status).toBe("number");
			}
		});

		it("nodes have all required fields", () => {
			const s = makeRichState();
			for (const n of s.nodes) {
				expect(n.id).toBeTruthy();
				expect(n.role).toBeTruthy();
				expect(typeof n.name).toBe("string");
				expect(n.boundingBox).toBeDefined();
				expect(typeof n.boundingBox.x).toBe("number");
				expect(typeof n.boundingBox.y).toBe("number");
				expect(typeof n.boundingBox.width).toBe("number");
				expect(typeof n.boundingBox.height).toBe("number");
			}
		});

		it("bugs have all required fields", () => {
			const s = makeRichState();
			for (const b of s.bugs) {
				expect(b.id).toBeTruthy();
				expect(["CRITICAL", "MAJOR", "MINOR"]).toContain(b.severity);
				expect(typeof b.type).toBe("string");
				expect(typeof b.description).toBe("string");
				expect(b.evidence).toBeDefined();
			}
		});
	});

	describe("optional fields", () => {
		it("axTree may be undefined", () => {
			const s = makeMinimalState();
			expect(s.axTree).toBeUndefined();
		});

		it("screenshots may be undefined", () => {
			const s = makeMinimalState();
			expect(s.screenshots).toBeUndefined();
		});

		it("profileId may be undefined", () => {
			const s = makeMinimalState();
			expect(s.profileId).toBeUndefined();
		});

		it("console.warnings and console.logs may be undefined", () => {
			const s = makeMinimalState();
			expect(s.console.warnings).toBeUndefined();
			expect(s.console.logs).toBeUndefined();
		});
	});
});

// ─── compactState() output contract ──────────────────────────────────────────

describe("compactState() output contract", () => {
	const full = makeRichState();

	describe("'full' variant", () => {
		it("output passes TaloxPageState schema", () => {
			assertValidPageState(compactState(full, "full"));
		});
	});

	describe("'agent' variant", () => {
		it("output passes AgentPageState schema", () => {
			assertValidAgentState(compactState(full, "agent"));
		});

		it("does not include nodes, network, or axTree", () => {
			const a = compactState(full, "agent") as any;
			expect(a.nodes).toBeUndefined();
			expect(a.network).toBeUndefined();
			expect(a.axTree).toBeUndefined();
		});

		it("bug shape is minimal (type/severity/description only)", () => {
			const a = compactState(full, "agent");
			for (const b of a.bugs) {
				expect(Object.keys(b)).toEqual(["type", "severity", "description"]);
			}
		});
	});

	describe("'debug' variant", () => {
		it("output passes DebugPageState schema", () => {
			assertValidDebugState(compactState(full, "debug"));
		});

		it("does not include interactiveElements", () => {
			const d = compactState(full, "debug") as any;
			expect(d.interactiveElements).toBeUndefined();
		});

		it("includes full bugs with evidence", () => {
			const d = compactState(full, "debug");
			for (const b of d.bugs) {
				expect(b.evidence).toBeDefined();
			}
		});
	});
});

// ─── PageStateCollector.collect() schema validation (mocked page) ─────────────

describe("PageStateCollector.collect() schema", () => {
	function makePageMock(
		overrides: Partial<{
			url: string;
			title: string;
			nodes: number;
			axSnapshot: any;
		}> = {},
	) {
		const { url = "https://test.com", title = "Test", _nodes = 0, axSnapshot = null } = overrides;

		const mock: any = {
			url: () => url,
			title: () => Promise.resolve(title),
			on: vi.fn(),
			off: vi.fn(),
			accessibility: {
				snapshot: vi.fn().mockResolvedValue(axSnapshot),
			},
			$$: vi.fn().mockResolvedValue([]),
			$$eval: vi.fn().mockResolvedValue([]),
			evaluate: vi.fn().mockResolvedValue([]),
			$: vi.fn().mockResolvedValue(null),
		};
		return mock;
	}

	// Fast options: no retries, no threshold delays, threshold=0 so any node count is enough
	const FAST_OPTS = { retry: { maxRetries: 0, initialDelayMs: 0 }, domFallbackThreshold: 0 };

	it("returns a valid TaloxPageState when AX-tree returns null (DOM fallback)", async () => {
		const page = makePageMock({ axSnapshot: null });
		const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: true });
		const state = await collector.collect();
		assertValidPageState(state);
	});

	it("returns correct url and title", async () => {
		const page = makePageMock({ url: "https://example.com", title: "Hello World" });
		const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
		const state = await collector.collect();
		expect(state.url).toBe("https://example.com");
		expect(state.title).toBe("Hello World");
	});

	it("timestamp is a valid ISO string", async () => {
		const page = makePageMock();
		const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
		const state = await collector.collect();
		expect(() => new Date(state.timestamp).toISOString()).not.toThrow();
	});

	it("console.errors starts empty (no page errors)", async () => {
		const page = makePageMock();
		const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
		const state = await collector.collect();
		expect(state.console.errors).toEqual([]);
	});

	it("bugs array starts empty (RulesEngine not yet applied)", async () => {
		const page = makePageMock();
		const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
		const state = await collector.collect();
		expect(state.bugs).toEqual([]);
	});

	it("returns valid state with a real AX-tree snapshot", async () => {
		// flattenAXTree requires a box/boundingBox on each node to include it
		const axSnapshot = {
			role: "WebArea",
			name: "Test Page",
			children: [
				{ role: "button", name: "Submit", box: { x: 10, y: 20, width: 100, height: 36 } },
				{ role: "textbox", name: "Email", value: "test@example.com", box: { x: 10, y: 60, width: 200, height: 36 } },
			],
		};
		const page = makePageMock({ axSnapshot });
		const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
		const state = await collector.collect();
		assertValidPageState(state);
		expect(state.nodes.length).toBeGreaterThan(0);
	});
});

// ─── State contract backward-compat invariants ────────────────────────────────

describe("TaloxPageState backward-compat invariants", () => {
	it("url is always present (never undefined or null)", () => {
		const s = makeMinimalState();
		expect(s.url).not.toBeNull();
		expect(s.url).not.toBeUndefined();
	});

	it("nodes is always an array (never null)", () => {
		const s = makeMinimalState();
		expect(Array.isArray(s.nodes)).toBe(true);
	});

	it("bugs is always an array (never null)", () => {
		const s = makeMinimalState();
		expect(Array.isArray(s.bugs)).toBe(true);
	});

	it("console.errors is always an array (never null)", () => {
		const s = makeMinimalState();
		expect(Array.isArray(s.console.errors)).toBe(true);
	});

	it("network.failedRequests is always an array (never null)", () => {
		const s = makeMinimalState();
		expect(Array.isArray(s.network.failedRequests)).toBe(true);
	});

	it("interactiveElements is always an array (never null)", () => {
		const s = makeMinimalState();
		expect(Array.isArray(s.interactiveElements)).toBe(true);
	});
});
