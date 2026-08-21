/**
 * Unit tests for InspectServer — DevTools-compatible inspect server.
 * All external dependencies (http, ws, playwright) are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock factories using vi.hoisted for hoisted mock objects ────────────────

const { mockHttpServer, mockWss, mockCreateServer } = vi.hoisted(() => {
	let capturedHandler: ((...args: any[]) => any) | undefined;
	const mockHttpServer = {
		listen: vi.fn(),
		close: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
		on: vi.fn(),
		address: vi.fn(),
	};
	const mockCreateServer = vi.fn().mockImplementation((handler: (...args: any[]) => any) => {
		capturedHandler = handler;
		return mockHttpServer;
	});
	mockCreateServer._getHandler = () => capturedHandler;
	const mockWss = {
		on: vi.fn(),
		close: vi.fn(),
	};
	return { mockHttpServer, mockWss, mockCreateServer };
});

vi.mock("node:http", () => {
	return {
		createServer: mockCreateServer,
	};
});

vi.mock("node:crypto", () => ({
	randomUUID: vi.fn().mockReturnValue("test-uuid-1234"),
}));

vi.mock("ws", () => ({
	WebSocketServer: vi.fn().mockImplementation(function (this: any) {
		return mockWss;
	}),
	WebSocket: { OPEN: 1 },
}));

vi.mock("playwright-core", () => ({}));

// Import after mocks
import { InspectServer } from "../../src/core/inspect/InspectServer.js";

describe("InspectServer", () => {
	let server: InspectServer;

	beforeEach(() => {
		vi.clearAllMocks();
		// Set up default mock behaviors for each test
		mockHttpServer.listen.mockImplementation((_port: number, _host: string, cb: (...args: any[]) => any) => {
			if (cb) cb();
			return mockHttpServer;
		});
		mockHttpServer.close.mockImplementation((cb?: (...args: any[]) => any) => {
			if (cb) cb();
			return mockHttpServer;
		});
		mockHttpServer.once.mockImplementation((_event: string, _cb: (...args: any[]) => any) => {
			return mockHttpServer;
		});
		mockHttpServer.removeListener.mockReturnValue(mockHttpServer);
		mockHttpServer.address.mockReturnValue({ address: "127.0.0.1", port: 9222, family: "IPv4" });
		mockWss.on.mockReturnValue(mockWss);
		mockWss.close.mockReturnValue(undefined);
		server = new InspectServer({ port: 9222, host: "127.0.0.1" });
	});

	// ─── Constructor ─────────────────────────────────────────────────────────

	describe("constructor", () => {
		it("creates server with default config", () => {
			const s = new InspectServer();
			expect(s.getAddress()).toContain("127.0.0.1:9222");
		});

		it("creates server with custom config", () => {
			const s = new InspectServer({ port: 8080, host: "localhost" });
			expect(s.getAddress()).toContain("localhost:8080");
		});
	});

	// ─── getAddress() ────────────────────────────────────────────────────────

	describe("getAddress", () => {
		it("returns the devtools URL with host and port", () => {
			const addr = server.getAddress();
			expect(addr).toBe("devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9222");
		});
	});

	// ─── attach() ────────────────────────────────────────────────────────────

	describe("attach", () => {
		function createMockPage(overrides: Record<string, any> = {}) {
			const cdpSession = {
				on: vi.fn(),
				off: vi.fn(),
				send: vi.fn().mockResolvedValue({}),
				detach: vi.fn().mockResolvedValue(undefined),
			};
			return {
				url: vi.fn().mockReturnValue("https://example.com"),
				context: vi.fn().mockReturnValue({
					newCDPSession: vi.fn().mockResolvedValue(cdpSession),
				}),
				_cdpSession: cdpSession,
				...overrides,
			};
		}

		it("creates a CDP session for the page", async () => {
			const mockPage = createMockPage();
			await server.attach(mockPage as any);

			expect(mockPage.context().newCDPSession).toHaveBeenCalledWith(mockPage);
		});

		it("starts the HTTP server on attach", async () => {
			const mockPage = createMockPage();
			await server.attach(mockPage as any);

			expect(mockHttpServer.listen).toHaveBeenCalledWith(9222, "127.0.0.1", expect.any(Function));
		});

		it("registers a WebSocket connection handler", async () => {
			const mockPage = createMockPage();
			await server.attach(mockPage as any);

			expect(mockWss.on).toHaveBeenCalledWith("connection", expect.any(Function));
		});

		it("does not start server again if already running", async () => {
			const mockPage = createMockPage();
			await server.attach(mockPage as any);

			// Reset listen call count
			mockHttpServer.listen.mockClear();
			await server.attach(mockPage as any);

			expect(mockHttpServer.listen).not.toHaveBeenCalled();
		});

		it("handles CDP session creation failure gracefully", async () => {
			const mockPage = createMockPage();
			mockPage.context.mockReturnValue({
				newCDPSession: vi.fn().mockRejectedValue(new Error("CDP not available")),
			});

			// Should not throw
			await expect(server.attach(mockPage as any)).resolves.toBeUndefined();
		});
	});

	// ─── detach() ────────────────────────────────────────────────────────────

	describe("detach", () => {
		it("closes the HTTP and WebSocket servers", async () => {
			const cdpSession = {
				on: vi.fn(),
				off: vi.fn(),
				send: vi.fn().mockResolvedValue({}),
				detach: vi.fn().mockResolvedValue(undefined),
			};
			const mockPage = {
				url: vi.fn().mockReturnValue("https://example.com"),
				context: vi.fn().mockReturnValue({
					newCDPSession: vi.fn().mockResolvedValue(cdpSession),
				}),
			};

			await server.attach(mockPage as any);
			server.detach();

			expect(mockWss.close).toHaveBeenCalled();
			expect(mockHttpServer.close).toHaveBeenCalled();
		});

		it("detaches the CDP session", async () => {
			const cdpSession = {
				on: vi.fn(),
				off: vi.fn(),
				send: vi.fn().mockResolvedValue({}),
				detach: vi.fn().mockResolvedValue(undefined),
			};
			const mockPage = {
				url: vi.fn().mockReturnValue("https://example.com"),
				context: vi.fn().mockReturnValue({
					newCDPSession: vi.fn().mockResolvedValue(cdpSession),
				}),
			};

			await server.attach(mockPage as any);
			server.detach();

			expect(cdpSession.detach).toHaveBeenCalled();
		});

		it("is a no-op when not running", () => {
			server.detach();
			expect(mockWss.close).not.toHaveBeenCalled();
			expect(mockHttpServer.close).not.toHaveBeenCalled();
		});
	});

	// ─── HTTP Request Handling ───────────────────────────────────────────────

	describe("HTTP request handling", () => {
		it("creates server with a request handler", () => {
			expect(mockCreateServer).toHaveBeenCalledWith(expect.any(Function));
		});

		it("handles /json endpoint with target list", async () => {
			const cdpSession = {
				on: vi.fn(),
				off: vi.fn(),
				send: vi.fn().mockResolvedValue({}),
				detach: vi.fn().mockResolvedValue(undefined),
			};
			const mockPage = {
				url: vi.fn().mockReturnValue("https://example.com"),
				context: vi.fn().mockReturnValue({
					newCDPSession: vi.fn().mockResolvedValue(cdpSession),
				}),
			};

			await server.attach(mockPage as any);

			const handler = (mockCreateServer as any)._getHandler();
			expect(handler).toBeDefined();

			const req = { url: "/json" };
			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
			};

			handler(req, res);

			expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
			const body = JSON.parse(res.end.mock.calls[0][0]);
			expect(body).toHaveLength(1);
			expect(body[0].type).toBe("page");
			expect(body[0].url).toBe("https://example.com");
			expect(body[0].title).toBe("(Talox controlled page)");
			expect(body[0].id).toBe("test-uuid-1234");
		});

		it("handles /json/list endpoint", async () => {
			const cdpSession = {
				on: vi.fn(),
				off: vi.fn(),
				send: vi.fn().mockResolvedValue({}),
				detach: vi.fn().mockResolvedValue(undefined),
			};
			const mockPage = {
				url: vi.fn().mockReturnValue("https://example.com"),
				context: vi.fn().mockReturnValue({
					newCDPSession: vi.fn().mockResolvedValue(cdpSession),
				}),
			};
			await server.attach(mockPage as any);

			const handler = (mockCreateServer as any)._getHandler();

			const req = { url: "/json/list" };
			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
			};

			handler(req, res);

			expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
			const body = JSON.parse(res.end.mock.calls[0][0]);
			expect(body).toHaveLength(1);
		});

		it("handles /json/version endpoint", () => {
			const handler = (mockCreateServer as any)._getHandler();

			const req = { url: "/json/version" };
			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
			};

			handler(req, res);

			expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
			const body = JSON.parse(res.end.mock.calls[0][0]);
			expect(body.Browser).toBe("Talox/Chromium");
			expect(body["Protocol-Version"]).toBe("1.3");
		});

		it("returns 404 for unknown paths", () => {
			const handler = (mockCreateServer as any)._getHandler();

			const req = { url: "/unknown" };
			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
			};

			handler(req, res);

			expect(res.writeHead).toHaveBeenCalledWith(404);
			expect(res.end).toHaveBeenCalledWith("Not Found");
		});

		it("defaults to / when req.url is null", () => {
			const handler = (mockCreateServer as any)._getHandler();

			const req = { url: null };
			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
			};

			handler(req, res);

			expect(res.writeHead).toHaveBeenCalledWith(404);
		});

		it("shows 'No page attached' title when no page is set", () => {
			// Don't attach a page
			const handler = (mockCreateServer as any)._getHandler();

			const req = { url: "/json" };
			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
			};

			handler(req, res);

			const body = JSON.parse(res.end.mock.calls[0][0]);
			expect(body[0].title).toBe("No page attached");
			expect(body[0].url).toBe("about:blank");
		});
	});
});
