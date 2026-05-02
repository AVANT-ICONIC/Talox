/**
 * Unit tests for CrossOriginManager — cross-origin iframe CDP session management.
 * All Playwright dependencies are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockCDPSession() {
	return {
		send: vi.fn().mockResolvedValue({ result: {} }),
		detach: vi.fn().mockResolvedValue(undefined),
		on: vi.fn(),
		off: vi.fn(),
	};
}

function createMockFrame(overrides: {
	name?: string;
	url?: string;
	parentFrame?: (() => any) | null;
}) {
	return {
		name: vi.fn().mockReturnValue(overrides.name ?? ""),
		url: vi.fn().mockReturnValue(overrides.url ?? ""),
		parentFrame: vi.fn().mockReturnValue(
			overrides.parentFrame === undefined ? null : overrides.parentFrame?.() ?? null,
		),
	};
}

function createMockPage(overrides: { newCDPSession?: any } = {}) {
	const cdpSession = overrides.newCDPSession ?? createMockCDPSession();
	return {
		on: vi.fn(),
		context: vi.fn().mockReturnValue({
			newCDPSession: vi.fn().mockResolvedValue(cdpSession),
		}),
		url: vi.fn().mockReturnValue("https://parent-example.com/page"),
	};
}

// Import after mocks are set up
import { CrossOriginManager } from "../../src/core/CrossOriginManager.js";

describe("CrossOriginManager", () => {
	let manager: CrossOriginManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new CrossOriginManager();
	});

	// ─── install() ───────────────────────────────────────────────────────────

	describe("install", () => {
		it("registers frameattached, framenavigated, framedetached listeners on the page", () => {
			const mockPage = createMockPage();
			manager.install(mockPage as any);

			expect(mockPage.on).toHaveBeenCalledWith("frameattached", expect.any(Function));
			expect(mockPage.on).toHaveBeenCalledWith("framenavigated", expect.any(Function));
			expect(mockPage.on).toHaveBeenCalledWith("framedetached", expect.any(Function));
		});

		it("stores the page reference for later use", () => {
			const mockPage = createMockPage();
			manager.install(mockPage as any);

			// Verify page is stored by checking that getSession returns nothing initially
			expect(manager.getSession("nonexistent")).toBeUndefined();
		});
	});

	// ─── getSession() ────────────────────────────────────────────────────────

	describe("getSession", () => {
		it("returns undefined when no session exists for the given frame ID", () => {
			expect(manager.getSession("frame-1")).toBeUndefined();
		});
	});

	// ─── getAllSessions() ────────────────────────────────────────────────────

	describe("getAllSessions", () => {
		it("returns empty array when no sessions are active", () => {
			expect(manager.getAllSessions()).toEqual([]);
		});
	});

	// ─── executeInFrame() ────────────────────────────────────────────────────

	describe("executeInFrame", () => {
		it("throws if no session exists for the given frame ID", async () => {
			await expect(manager.executeInFrame("missing-frame", "Runtime.evaluate")).rejects.toThrow(
				"No CDP session for frame: missing-frame",
			);
		});
	});

	// ─── dispose() ───────────────────────────────────────────────────────────

	describe("dispose", () => {
		it("clears all sessions and resets page reference", () => {
			const mockPage = createMockPage();
			manager.install(mockPage as any);
			manager.dispose();

			expect(manager.getAllSessions()).toEqual([]);
			expect(manager.getSession("any")).toBeUndefined();
		});

		it("detaches all CDP sessions on dispose", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			// Simulate a frameattached event for a cross-origin frame
			const parentFrame = createMockFrame({
				name: "parent",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "cross-origin-frame",
				url: "https://other-domain.com/embed",
				parentFrame: () => parentFrame,
			});

			// Get the frameattached handler
			const frameAttachedHandler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			expect(frameAttachedHandler).toBeDefined();
			await frameAttachedHandler!(childFrame);

			// Now dispose
			manager.dispose();

			expect(mockCdp.detach).toHaveBeenCalled();
			expect(manager.getAllSessions()).toEqual([]);
		});
	});

	// ─── Frame event handling ────────────────────────────────────────────────

	describe("frameattached event", () => {
		it("creates a CDP session for a cross-origin child frame", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "my-iframe",
				url: "https://other-domain.com/embed",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			const session = manager.getSession("my-iframe");
			expect(session).toBeDefined();
			expect(session?.origin).toBe("https://other-domain.com");
			expect(session?.frameId).toBe("my-iframe");
		});

		it("does NOT create a session for same-origin child frames", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://example.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "same-origin-frame",
				url: "https://example.com/other",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			expect(manager.getSession("same-origin-frame")).toBeUndefined();
		});

		it("does NOT create a session for the main frame (no parent)", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const mainFrame = createMockFrame({
				name: "",
				url: "https://example.com/page",
				parentFrame: null,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(mainFrame);

			expect(manager.getAllSessions()).toHaveLength(0);
		});

		it("handles CDP session creation failure gracefully", async () => {
			const mockPage = createMockPage();
			// Make newCDPSession reject
			mockPage.context.mockReturnValue({
				newCDPSession: vi.fn().mockRejectedValue(new Error("CDP failed")),
			});
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "failing-frame",
				url: "https://other.com/embed",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];

			// Should not throw
			await expect(handler!(childFrame)).resolves.toBeUndefined();
			expect(manager.getSession("failing-frame")).toBeUndefined();
		});
	});

	describe("framenavigated event", () => {
		it("removes old session and creates new one for cross-origin frame", async () => {
			const mockCdp1 = createMockCDPSession();
			const mockCdp2 = createMockCDPSession();
			let cdpIndex = 0;
			const mockPage = createMockPage();
			mockPage.context.mockReturnValue({
				newCDPSession: vi.fn().mockImplementation(() => {
					cdpIndex++;
					return Promise.resolve(cdpIndex === 1 ? mockCdp1 : mockCdp2);
				}),
			});
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "nav-frame",
				url: "https://other.com/new-url",
				parentFrame: () => parentFrame,
			});

			// First, attach the frame
			const attachHandler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await attachHandler!(childFrame);
			expect(manager.getSession("nav-frame")).toBeDefined();
			expect(manager.getSession("nav-frame")?.cdpSession).toBe(mockCdp1);

			// Now navigate the frame
			const navHandler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "framenavigated",
			)?.[1];
			await navHandler!(childFrame);

			// Old session should be detached, new one created
			expect(mockCdp1.detach).toHaveBeenCalled();
			const newSession = manager.getSession("nav-frame");
			expect(newSession).toBeDefined();
			expect(newSession?.cdpSession).toBe(mockCdp2);
		});
	});

	describe("framedetached event", () => {
		it("removes the session for the detached frame", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "detach-frame",
				url: "https://other.com/embed",
				parentFrame: () => parentFrame,
			});

			// First attach
			const attachHandler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await attachHandler!(childFrame);
			expect(manager.getSession("detach-frame")).toBeDefined();

			// Then detach
			const detachHandler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "framedetached",
			)?.[1];
			detachHandler!(childFrame);

			expect(manager.getSession("detach-frame")).toBeUndefined();
			expect(mockCdp.detach).toHaveBeenCalled();
		});
	});

	// ─── executeInFrame with active session ──────────────────────────────────

	describe("executeInFrame with active session", () => {
		it("sends a CDP command through the stored session", async () => {
			const mockCdp = createMockCDPSession();
			mockCdp.send.mockResolvedValue({ result: { value: 42 } });
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "exec-frame",
				url: "https://other.com/embed",
				parentFrame: () => parentFrame,
			});

			const attachHandler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await attachHandler!(childFrame);

			const result = await manager.executeInFrame("exec-frame", "Runtime.evaluate", {
				expression: "1+1",
			});
			expect(mockCdp.send).toHaveBeenCalledWith("Runtime.evaluate", {
				expression: "1+1",
			});
		});
	});

	// ─── Frame ID resolution ─────────────────────────────────────────────────

	describe("frame ID resolution", () => {
		it("uses frame name as ID when available", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "named-frame",
				url: "https://other.com/embed",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			const session = manager.getSession("named-frame");
			expect(session).toBeDefined();
			expect(session?.frameId).toBe("named-frame");
		});

		it("falls back to URL-based key when frame name is empty", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "",
				url: "https://other.com/embed",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			const session = manager.getSession("frame:https://other.com/embed");
			expect(session).toBeDefined();
			expect(session?.origin).toBe("https://other.com");
		});
	});

	// ─── Origin detection ────────────────────────────────────────────────────

	describe("cross-origin detection", () => {
		it("detects different origins (different domains)", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://example.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "cross-domain",
				url: "https://different.com/widget",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			expect(manager.getSession("cross-domain")).toBeDefined();
		});

		it("detects same origin (same domain, different paths)", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://example.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "same-origin",
				url: "https://example.com/other/path",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			expect(manager.getSession("same-origin")).toBeUndefined();
		});

		it("treats different ports as cross-origin", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://example.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "diff-port",
				url: "https://example.com:8443/page",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			expect(manager.getSession("diff-port")).toBeDefined();
		});

		it("treats http vs https as cross-origin", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://example.com/page",
				parentFrame: null,
			});
			const childFrame = createMockFrame({
				name: "http-frame",
				url: "http://example.com/page",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(childFrame);

			expect(manager.getSession("http-frame")).toBeDefined();
		});
	});

	// ─── getAllSessions with multiple frames ──────────────────────────────────

	describe("getAllSessions", () => {
		it("returns all tracked cross-origin sessions", async () => {
			const mockCdp = createMockCDPSession();
			const mockPage = createMockPage({ newCDPSession: mockCdp });
			manager.install(mockPage as any);

			const parentFrame = createMockFrame({
				name: "",
				url: "https://parent.com/page",
				parentFrame: null,
			});

			const frame1 = createMockFrame({
				name: "frame-1",
				url: "https://other1.com/embed",
				parentFrame: () => parentFrame,
			});
			const frame2 = createMockFrame({
				name: "frame-2",
				url: "https://other2.com/embed",
				parentFrame: () => parentFrame,
			});

			const handler = mockPage.on.mock.calls.find(
				(call: any[]) => call[0] === "frameattached",
			)?.[1];
			await handler!(frame1);
			await handler!(frame2);

			const all = manager.getAllSessions();
			expect(all).toHaveLength(2);
			const ids = all.map((s) => s.frameId);
			expect(ids).toContain("frame-1");
			expect(ids).toContain("frame-2");
		});
	});
});
