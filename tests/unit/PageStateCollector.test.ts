/**
 * @file PageStateCollector.test.ts
 * @description Unit tests for PageStateCollector — covers collect(), AX tree
 * extraction, console error collection, network failure tracking, interactive
 * element detection, and edge cases (closed page, no AX tree, empty DOM).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageStateCollector } from "../../src/core/PageStateCollector";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a fully-mocked Playwright Page for PageStateCollector. */
function makeMockPage(
	overrides: Partial<{
		url: string;
		title: string;
		isClosed: boolean;
		axSnapshot: any;
		accessibilityAvailable: boolean;
		$$result: any[];
		$$evalResult: any[];
		evaluateResult: any;
	}> = {},
) {
	const {
		url = "https://example.com",
		title = "Test Page",
		isClosed = false,
		axSnapshot = null,
		accessibilityAvailable = true,
		$$result = [],
		$$evalResult = [],
		evaluateResult = [],
	} = overrides;

	const listeners: Record<string, ((...args: any[]) => any)[]> = {};

	const page: any = {
		url: vi.fn(() => url),
		title: vi.fn(() => Promise.resolve(title)),
		isClosed: vi.fn(() => isClosed),
		on: vi.fn((event: string, handler: (...args: any[]) => any) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(handler);
		}),
		off: vi.fn(),
		...(accessibilityAvailable
			? { accessibility: { snapshot: vi.fn(() => Promise.resolve(axSnapshot)) } }
			: {}),
		$$: vi.fn(() => Promise.resolve($$result)),
		$$eval: vi.fn(() => Promise.resolve($$evalResult)),
		evaluate: vi.fn(() => Promise.resolve(evaluateResult)),
		$: vi.fn(() => Promise.resolve(null)),
		/** Simulate firing a console event on the page mock. */
		_emit(event: string, ...args: any[]) {
			for (const h of listeners[event] ?? []) h(...args);
		},
	};

	return page;
}

// Options that disable retries and delays to keep tests fast
const FAST_OPTS = {
	retry: { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 },
	domFallbackThreshold: 0,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("PageStateCollector", () => {
	// ─── collect() — closed page ──────────────────────────────────────────────

	describe("closed page guard", () => {
		it("returns a fallback state when page.isClosed() is true", async () => {
			const page = makeMockPage({ isClosed: true });
			const collector = new PageStateCollector(page, FAST_OPTS);
			const state = await collector.collect();
			expect(state.url).toBe("about:blank");
			expect(state.title).toBe("");
			expect(state.nodes).toEqual([]);
			expect(state.interactiveElements).toEqual([]);
			expect(state.console.errors).toEqual([]);
			expect(state.network.failedRequests).toEqual([]);
			expect(state.timing?.totalMs).toBe(0);
		});

		it("returns a valid ISO timestamp when page is closed", async () => {
			const page = makeMockPage({ isClosed: true });
			const collector = new PageStateCollector(page, FAST_OPTS);
			const state = await collector.collect();
			expect(state.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});
	});

	// ─── collect() — normal operation ────────────────────────────────────────

	describe("collect() basic fields", () => {
		it("captures page URL", async () => {
			const page = makeMockPage({ url: "https://app.example.com/dashboard" });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
			const state = await collector.collect();
			expect(state.url).toBe("https://app.example.com/dashboard");
		});

		it("captures page title", async () => {
			const page = makeMockPage({ title: "Dashboard — MyApp" });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
			const state = await collector.collect();
			expect(state.title).toBe("Dashboard — MyApp");
		});

		it("returns a valid ISO timestamp", async () => {
			const page = makeMockPage();
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
			const state = await collector.collect();
			expect(() => new Date(state.timestamp).toISOString()).not.toThrow();
		});

		it("includes timing metadata with totalMs >= 0", async () => {
			const page = makeMockPage();
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });
			const state = await collector.collect();
			expect(state.timing).toBeDefined();
			expect(state.timing!.totalMs).toBeGreaterThanOrEqual(0);
			expect(state.timing!.collectedAt).toBe(state.timestamp);
		});

		it("falls back immediately when modern Playwright has no page.accessibility API", async () => {
			const page = makeMockPage({ accessibilityAvailable: false });
			const collector = new PageStateCollector(page, {
				useDomFallback: true,
				domFallbackThreshold: 0,
			});

			await collector.collect();

			const stats = collector.getRetryStats();
			expect(stats.axTreeAttempts).toBe(0);
			expect(stats.totalDelayMs).toBe(0);
			expect(page.$$).toHaveBeenCalled();
		});

		it.each(["about:blank", "about:srcdoc"])(
			"skips hydration backoff for synthetic document %s",
			async (url) => {
				const page = makeMockPage({ url, axSnapshot: null });
				const collector = new PageStateCollector(page, { useDomFallback: false });

				await collector.collect();

				expect(page.accessibility.snapshot).toHaveBeenCalledTimes(1);
				expect(collector.getRetryStats().totalDelayMs).toBe(0);
			},
		);
	});

	// ─── AX tree extraction ──────────────────────────────────────────────────

	describe("AX tree extraction", () => {
		it("flattens AX tree with box property into TaloxNode[]", async () => {
			const axSnapshot = {
				role: "WebArea",
				name: "Page",
				children: [
					{ role: "button", name: "Submit", box: { x: 10, y: 20, width: 80, height: 30 } },
					{ role: "link", name: "Home", box: { x: 0, y: 0, width: 50, height: 20 } },
				],
			};
			const page = makeMockPage({ axSnapshot });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			const state = await collector.collect();
			expect(state.nodes.length).toBe(2);
			expect(state.nodes[0]).toMatchObject({ role: "button", name: "Submit" });
			expect(state.nodes[1]).toMatchObject({ role: "link", name: "Home" });
		});

		it("handles AX nodes with boundingBox property instead of box", async () => {
			const axSnapshot = {
				role: "WebArea",
				name: "",
				children: [{ role: "textbox", name: "Search", boundingBox: { x: 5, y: 5, width: 200, height: 30 } }],
			};
			const page = makeMockPage({ axSnapshot });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			const state = await collector.collect();
			expect(state.nodes.length).toBe(1);
			expect(state.nodes[0].role).toBe("textbox");
		});

		it("skips AX nodes without a bounding box", async () => {
			const axSnapshot = {
				role: "WebArea",
				name: "Page",
				children: [
					{ role: "heading", name: "Title" }, // no box
					{ role: "button", name: "OK", box: { x: 0, y: 0, width: 40, height: 20 } },
				],
			};
			const page = makeMockPage({ axSnapshot });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			const state = await collector.collect();
			expect(state.nodes.length).toBe(1);
			expect(state.nodes[0].name).toBe("OK");
		});

		it("preserves node value as attribute when present", async () => {
			const axSnapshot = {
				role: "WebArea",
				name: "",
				children: [
					{ role: "textbox", name: "Email", value: "user@test.com", box: { x: 0, y: 0, width: 100, height: 30 } },
				],
			};
			const page = makeMockPage({ axSnapshot });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			const state = await collector.collect();
			expect(state.nodes[0].attributes?.value).toBe("user@test.com");
		});

		it("returns empty nodes when AX snapshot is null and useDomFallback=false", async () => {
			const page = makeMockPage({ axSnapshot: null });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 0 });
			const state = await collector.collect();
			expect(state.nodes).toEqual([]);
		});
	});

	// ─── Console error collection ────────────────────────────────────────────

	describe("console error collection", () => {
		it("captures console error messages via page console event", async () => {
			const page = makeMockPage({
				axSnapshot: { role: "WebArea", name: "", box: { x: 0, y: 0, width: 800, height: 600 } },
			});
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });

			// Simulate console error events
			page._emit("console", { type: () => "error", text: () => "Uncaught TypeError: x is not a function" });
			page._emit("console", { type: () => "error", text: () => "ReferenceError: foo is not defined" });

			const state = await collector.collect();
			expect(state.console.errors).toHaveLength(2);
			expect(state.console.errors[0]).toContain("TypeError");
			expect(state.console.errors[1]).toContain("ReferenceError");
		});

		it("ignores non-error console messages", async () => {
			const page = makeMockPage({
				axSnapshot: { role: "WebArea", name: "", box: { x: 0, y: 0, width: 800, height: 600 } },
			});
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });

			page._emit("console", { type: () => "log", text: () => "just a log" });
			page._emit("console", { type: () => "warning", text: () => "a warning" });
			page._emit("console", { type: () => "error", text: () => "actual error" });

			const state = await collector.collect();
			expect(state.console.errors).toHaveLength(1);
			expect(state.console.errors[0]).toBe("actual error");
		});
	});

	// ─── Network failure tracking ────────────────────────────────────────────

	describe("network failure tracking", () => {
		it("captures 4xx/5xx responses via page response event", async () => {
			const page = makeMockPage({
				axSnapshot: { role: "WebArea", name: "", box: { x: 0, y: 0, width: 800, height: 600 } },
			});
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });

			page._emit("response", {
				status: () => 403,
				url: () => "https://api.example.com/data",
				request: () => ({ resourceType: () => "xhr" }),
			});
			page._emit("response", {
				status: () => 500,
				url: () => "https://api.example.com/crash",
				request: () => ({ resourceType: () => "fetch" }),
			});

			const state = await collector.collect();
			expect(state.network.failedRequests).toHaveLength(2);
			expect(state.network.failedRequests[0]).toMatchObject({ url: "https://api.example.com/data", status: 403 });
			expect(state.network.failedRequests[1]).toMatchObject({ url: "https://api.example.com/crash", status: 500 });
		});

		it("ignores 2xx/3xx responses", async () => {
			const page = makeMockPage({
				axSnapshot: { role: "WebArea", name: "", box: { x: 0, y: 0, width: 800, height: 600 } },
			});
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });

			page._emit("response", {
				status: () => 200,
				url: () => "https://ok.example.com",
				request: () => ({ resourceType: () => "document" }),
			});
			page._emit("response", {
				status: () => 301,
				url: () => "https://redirect.example.com",
				request: () => ({ resourceType: () => "document" }),
			});

			const state = await collector.collect();
			expect(state.network.failedRequests).toEqual([]);
		});
	});

	// ─── Retry stats ─────────────────────────────────────────────────────────

	describe("retry stats", () => {
		it("returns initial retry stats", () => {
			const page = makeMockPage();
			const collector = new PageStateCollector(page, FAST_OPTS);
			const stats = collector.getRetryStats();
			expect(stats).toMatchObject({
				attempts: 0,
				axTreeAttempts: 0,
				axTreeSuccesses: 0,
				fallbackUsed: false,
				totalDelayMs: 0,
			});
		});

		it("increments attempts after collect()", async () => {
			const page = makeMockPage({
				axSnapshot: { role: "WebArea", name: "", box: { x: 0, y: 0, width: 800, height: 600 } },
			});
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			await collector.collect();
			const stats = collector.getRetryStats();
			expect(stats.attempts).toBe(1);
			expect(stats.axTreeAttempts).toBeGreaterThanOrEqual(1);
		});

		it("resetRetryStats clears all counters", async () => {
			const page = makeMockPage({
				axSnapshot: { role: "WebArea", name: "", box: { x: 0, y: 0, width: 800, height: 600 } },
			});
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			await collector.collect();
			collector.resetRetryStats();
			const stats = collector.getRetryStats();
			expect(stats.attempts).toBe(0);
			expect(stats.axTreeAttempts).toBe(0);
			expect(stats.axTreeSuccesses).toBe(0);
			expect(stats.fallbackUsed).toBe(false);
			expect(stats.totalDelayMs).toBe(0);
		});

		it("marks fallbackUsed when AX tree returns null and useDomFallback=true", async () => {
			const page = makeMockPage({ axSnapshot: null });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: true, domFallbackThreshold: 0 });
			await collector.collect();
			expect(collector.getRetryStats().fallbackUsed).toBe(true);
		});
	});

	// ─── Interactive element detection ───────────────────────────────────────

	describe("interactive elements", () => {
		it("collects interactive elements via $$eval when AX tree is available", async () => {
			const interactiveEls = [
				{ id: "dom-0", tagName: "button", boundingBox: { x: 0, y: 0, width: 100, height: 30 } },
				{ id: "dom-1", tagName: "a", boundingBox: { x: 100, y: 0, width: 50, height: 20 } },
			];
			const axSnapshot = {
				role: "WebArea",
				name: "",
				children: [{ role: "button", name: "Click", box: { x: 0, y: 0, width: 100, height: 30 } }],
			};
			const page = makeMockPage({ axSnapshot, $$evalResult: interactiveEls, evaluateResult: [] });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			const state = await collector.collect();
			expect(state.interactiveElements.length).toBeGreaterThanOrEqual(2);
		});

		it("merges shadow DOM elements into interactive elements", async () => {
			const axSnapshot = {
				role: "WebArea",
				name: "",
				children: [{ role: "button", name: "OK", box: { x: 0, y: 0, width: 40, height: 20 } }],
			};
			const shadowEl = {
				id: "shadow-0",
				tagName: "button",
				boundingBox: { x: 200, y: 200, width: 50, height: 20 },
				inShadowDom: true,
				shadowRootPath: ["my-component"],
			};
			const page = makeMockPage({ axSnapshot, evaluateResult: [shadowEl] });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			const state = await collector.collect();
			const shadow = state.interactiveElements.find((el: any) => el.inShadowDom);
			expect(shadow).toBeDefined();
		});
	});

	// ─── Deep/nested AX tree ─────────────────────────────────────────────────

	describe("deep AX tree traversal", () => {
		it("recursively flattens nested children", async () => {
			const axSnapshot = {
				role: "WebArea",
				name: "",
				children: [
					{
						role: "main",
						name: "",
						children: [
							{
								role: "section",
								name: "",
								children: [{ role: "button", name: "Deep", box: { x: 1, y: 1, width: 10, height: 10 } }],
							},
						],
					},
				],
			};
			const page = makeMockPage({ axSnapshot });
			const collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false, domFallbackThreshold: 1 });
			const state = await collector.collect();
			expect(state.nodes.length).toBe(1);
			expect(state.nodes[0].name).toBe("Deep");
		});
	});

	// ─── Constructor event wiring ────────────────────────────────────────────

	describe("constructor event wiring", () => {
		it("registers console and response listeners on the page", () => {
			const page = makeMockPage();
			const collector = new PageStateCollector(page, FAST_OPTS);
			const onCalls = page.on.mock.calls.map((c: any[]) => c[0]);
			expect(onCalls).toContain("console");
			expect(onCalls).toContain("response");
		});
	});
});
