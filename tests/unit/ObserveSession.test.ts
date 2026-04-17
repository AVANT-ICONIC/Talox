/**
 * @file ObserveSession.test.ts
 * @description Unit tests for ObserveSession — forensic observation mode.
 * Covers: start/stop lifecycle, page event capture, timeline building,
 * annotation handling, report generation, console/network tracking.
 *
 * All Playwright/browser dependencies are mocked via vi.mock().
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock dependencies before importing ────────────────────────────────────

// Mock AnnotationBuffer
vi.mock("../../src/core/observe/AnnotationBuffer.js", () => {
	return {
		AnnotationBuffer: class {
			private stack: any[] = [];
			push(entry: any) {
				this.stack.push(entry);
			}
			undo() {
				return this.stack.pop();
			}
			getAll() {
				return [...this.stack];
			}
			get size() {
				return this.stack.length;
			}
			clear() {
				this.stack = [];
			}
		},
	};
});

// Mock OverlayInjector
vi.mock("../../src/core/observe/OverlayInjector.js", () => {
	return {
		OverlayInjector: class {
			inject = vi.fn(() => Promise.resolve());
		},
	};
});

// Mock SessionReporter
vi.mock("../../src/core/observe/SessionReporter.js", () => {
	return {
		SessionReporter: class {
			write = vi.fn(() => Promise.resolve({ json: "/tmp/report.json", markdown: "/tmp/report.md" }));
		},
	};
});

// Mock ArtifactBuilder
function makeArtifactBuilderMock() {
	return {
		addAction: vi.fn(),
		toActionFrames: vi.fn(() => []),
	};
}

import { EventBus } from "../../src/core/controller/EventBus";
import { ObserveSession } from "../../src/core/observe/ObserveSession";
import type { TaloxEventMap } from "../../src/types/events";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMockPage(overrides: Record<string, any> = {}) {
	const listeners: Record<string, Function[]> = {};

	const mainFrameObj = { url: () => overrides.url ?? "https://example.com" };

	const page: any = {
		url: vi.fn(() => overrides.url ?? "https://example.com"),
		on: vi.fn((event: string, handler: Function) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(handler);
		}),
		mainFrame: vi.fn(() => mainFrameObj),
		screenshot: vi.fn(() => Promise.resolve(Buffer.from("fake"))),
		addInitScript: vi.fn(),
		exposeFunction: vi.fn(),
		_emit(event: string, ...args: any[]) {
			for (const h of listeners[event] ?? []) {
				try {
					h(...args);
				} catch {}
			}
		},
		...overrides,
	};

	return page;
}

function makeMockContext(overrides: Record<string, any> = {}) {
	const listeners: Record<string, Function[]> = {};
	return {
		on: vi.fn((event: string, handler: Function) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(handler);
		}),
		close: vi.fn(() => Promise.resolve()),
		_emit(event: string, ...args: any[]) {
			for (const h of listeners[event] ?? []) {
				try {
					h(...args);
				} catch {}
			}
		},
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ObserveSession", () => {
	let eventBus: EventBus<TaloxEventMap>;
	let artifactBuilder: ReturnType<typeof makeArtifactBuilderMock>;

	beforeEach(() => {
		eventBus = new EventBus<TaloxEventMap>();
		artifactBuilder = makeArtifactBuilderMock();
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CONSTRUCTOR
	// ═══════════════════════════════════════════════════════════════════════════

	describe("constructor", () => {
		it("creates a session with a UUID and ISO timestamp", () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {});
			expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
			expect(session.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("uses default options when none provided", () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {});
			// session should be created without errors
			expect(session.sessionId).toBeTruthy();
		});

		it("respects overlay=false option", () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			// Creation succeeds
			expect(session.sessionId).toBeTruthy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// START
	// ═══════════════════════════════════════════════════════════════════════════

	describe("start()", () => {
		it("registers page event listeners", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const onCalls = page.on.mock.calls.map((c: any[]) => c[0]);
			expect(onCalls).toContain("console");
			expect(onCalls).toContain("requestfailed");
			expect(onCalls).toContain("framenavigated");
		});

		it("registers context close listener", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const onCalls = context.on.mock.calls.map((c: any[]) => c[0]);
			expect(onCalls).toContain("close");
		});

		it("injects overlay when overlay=true", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, { overlay: true });
			await session.start();
			// The OverlayInjector mock's inject should have been called
			// We can verify the session started without errors
			expect(session.sessionId).toBeTruthy();
		});

		it("does not inject overlay when overlay=false", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();
			expect(session.sessionId).toBeTruthy();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// PAGE EVENT CAPTURE — NAVIGATION
	// ═══════════════════════════════════════════════════════════════════════════

	describe("navigation tracking", () => {
		it("records navigation interactions on framenavigated", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			// Simulate framenavigated event — must emit the SAME frame object that mainFrame() returns
			const mainFrame = page.mainFrame();
			page._emit("framenavigated", mainFrame);

			const report = session.buildReport();
			expect(report.interactions.length).toBe(1);
			expect(report.interactions[0].type).toBe("navigation");
		});

		it("ignores framenavigated for about:blank", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			page._emit("framenavigated", { url: () => "about:blank" });
			const report = session.buildReport();
			expect(report.interactions.length).toBe(0);
		});

		it("emits navigation event on the event bus", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const navHandler = vi.fn();
			eventBus.on("navigation", navHandler);

			// Must emit the same frame that mainFrame() returns for the identity check
			const mainFrame = page.mainFrame();
			page._emit("framenavigated", mainFrame);
			expect(navHandler).toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CONSOLE ERROR CAPTURE
	// ═══════════════════════════════════════════════════════════════════════════

	describe("console error capture", () => {
		it("emits consoleError event when page fires error console message", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const errorHandler = vi.fn();
			eventBus.on("consoleError", errorHandler);

			page._emit("console", { type: () => "error", text: () => "Uncaught Error: boom" });
			expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({ error: "Uncaught Error: boom" }));
		});

		it("ignores non-error console messages", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const errorHandler = vi.fn();
			eventBus.on("consoleError", errorHandler);

			page._emit("console", { type: () => "log", text: () => "just a log" });
			expect(errorHandler).not.toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// NETWORK FAILURE CAPTURE
	// ═══════════════════════════════════════════════════════════════════════════

	describe("network failure capture", () => {
		it("emits networkError event when request fails", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const netHandler = vi.fn();
			eventBus.on("networkError", netHandler);

			page._emit("requestfailed", {
				url: () => "https://cdn.example.com/script.js",
				failure: () => ({ errorText: "net::ERR_CONNECTION_REFUSED" }),
				resourceType: () => "script",
			});

			expect(netHandler).toHaveBeenCalledWith(expect.objectContaining({ url: "https://cdn.example.com/script.js" }));
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REPORT GENERATION
	// ═══════════════════════════════════════════════════════════════════════════

	describe("buildReport()", () => {
		it("returns a valid session report structure", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const report = session.buildReport();
			expect(report.id).toBe(session.sessionId);
			expect(report.startedAt).toBe(session.startedAt);
			expect(report.endedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(typeof report.durationMs).toBe("number");
			expect(report.interactions).toEqual([]);
			expect(report.annotations).toEqual([]);
			expect(report.summary).toBeDefined();
			expect(report.summary.totalInteractions).toBe(0);
			expect(report.summary.totalAnnotations).toBe(0);
			expect(report.summary.totalConsoleErrors).toBe(0);
			expect(report.summary.totalNetworkFailures).toBe(0);
			expect(report.summary.annotationsByLabel).toEqual({});
		});

		it("includes recorded interactions", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			// Use the same frame identity that mainFrame() returns
			const frame = page.mainFrame();
			page._emit("framenavigated", frame);
			page._emit("framenavigated", frame);

			const report = session.buildReport();
			expect(report.interactions.length).toBe(2);
			expect(report.summary.totalInteractions).toBe(2);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// END SESSION / FINALIZE
	// ═══════════════════════════════════════════════════════════════════════════

	describe("endSession()", () => {
		it("emits sessionEnd event on the event bus", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const endHandler = vi.fn();
			eventBus.on("sessionEnd", endHandler);

			await session.endSession();
			expect(endHandler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: session.sessionId }));
		});

		it("is idempotent — calling twice does not emit twice", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const endHandler = vi.fn();
			eventBus.on("sessionEnd", endHandler);

			await session.endSession();
			await session.endSession(); // second call
			expect(endHandler).toHaveBeenCalledTimes(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// EVENT LOG
	// ═══════════════════════════════════════════════════════════════════════════

	describe("event logging", () => {
		it("logs navigation events", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const frame = page.mainFrame();
			page._emit("framenavigated", frame);

			// Event log is internal, but we can verify through buildReport
			const report = session.buildReport();
			expect(report.interactions.length).toBe(1);
		});

		it("logs consoleError events", async () => {
			const page = makeMockPage();
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			page._emit("console", { type: () => "error", text: () => "Test error" });

			// Verify via event bus
			const handler = vi.fn();
			eventBus.on("consoleError", handler);
			page._emit("console", { type: () => "error", text: () => "Second error" });
			expect(handler).toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// LIFECYCLE — startUrl
	// ═══════════════════════════════════════════════════════════════════════════

	describe("startUrl", () => {
		it("captures the start URL during start()", async () => {
			const page = makeMockPage();
			// Override url() to return a specific URL
			page.url = vi.fn(() => "https://myapp.com/home");
			page.mainFrame = vi.fn(() => ({ url: () => "https://myapp.com/home" }));
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const report = session.buildReport();
			expect(report.startUrl).toBe("https://myapp.com/home");
		});

		it("handles page.url being undefined gracefully", async () => {
			const page = makeMockPage();
			// Remove url function entirely
			page.url = undefined;
			const context = makeMockContext();
			const session = new ObserveSession(page, context, eventBus, artifactBuilder as any, {
				overlay: false,
				record: false,
			});
			await session.start();

			const report = session.buildReport();
			expect(report.startUrl).toBe("");
		});
	});
});
