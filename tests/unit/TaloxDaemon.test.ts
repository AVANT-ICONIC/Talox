/**
 * Unit tests for TaloxDaemon + commandHandler — daemon lifecycle and command parsing.
 * All external dependencies (net, TaloxController, etc.) are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock factories ─────────────────────────────────────────────────────────

const { mockController, mockNetServer } = vi.hoisted(() => {
	const mockController = {
		launch: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		navigate: vi.fn().mockResolvedValue({
			url: "https://example.com",
			title: "Example",
		}),
		click: vi.fn().mockResolvedValue({
			url: "https://example.com",
			title: "Example",
		}),
		type: vi.fn().mockResolvedValue({
			url: "https://example.com",
			title: "Example",
		}),
		getState: vi.fn().mockResolvedValue({
			url: "https://example.com",
			title: "Example",
			nodes: [],
			interactiveElements: [],
			console: { errors: [] },
			network: { failedRequests: [] },
			bugs: [],
			timestamp: new Date().toISOString(),
		}),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-screenshot")),
	};

	const mockNetServer = {
		listen: vi.fn(),
		close: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
		address: vi.fn().mockReturnValue({ address: "127.0.0.1", port: 9222, family: "IPv4" }),
	};

	return { mockController, mockNetServer };
});

vi.mock("../../src/core/controller/TaloxController.js", () => ({
	TaloxController: vi.fn().mockImplementation(function(this: any) { return mockController; }),
}));

vi.mock("node:crypto", () => ({
	randomUUID: vi.fn().mockReturnValue("test-session-uuid"),
}));

vi.mock("node:os", () => ({
	platform: vi.fn().mockReturnValue("linux"),
}));

vi.mock("node:net", () => ({
	createServer: vi.fn().mockImplementation((handler: Function) => {
		(mockNetServer as any)._connectionHandler = handler;
		return mockNetServer;
	}),
}));

// Import after mocks
import { generateSessionId, handleCommand } from "../../src/core/daemon/commandHandler.js";
import { TaloxDaemon } from "../../src/core/daemon/TaloxDaemon.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupNetServer() {
	mockNetServer.listen.mockImplementation((_arg1: any, _arg2: any, _arg3: any) => {
		const cb = typeof _arg2 === "function" ? _arg2 : _arg3;
		if (cb) cb();
		return mockNetServer;
	});
	mockNetServer.close.mockImplementation((cb?: Function) => {
		if (cb) cb();
		return mockNetServer;
	});
	mockNetServer.once.mockImplementation((_event: string, _cb: Function) => mockNetServer);
	mockNetServer.removeListener.mockReturnValue(mockNetServer);
	mockNetServer.on.mockReturnValue(mockNetServer);
	mockNetServer.address.mockReturnValue({ address: "127.0.0.1", port: 9222, family: "IPv4" });
}

function createMockSocket() {
	let dataHandler: Function | undefined;
	let errorHandler: Function | undefined;
	const socket = {
		on: vi.fn().mockImplementation((event: string, handler: Function) => {
			if (event === "data") dataHandler = handler;
			if (event === "error") errorHandler = handler;
		}),
		write: vi.fn(),
		destroyed: false,
		_getDataHandler: () => dataHandler,
		_getErrorHandler: () => errorHandler,
	};
	return socket;
}

// ─── commandHandler tests ───────────────────────────────────────────────────

describe("commandHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("navigate", () => {
		it("navigates and returns success response", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-1",
				action: "navigate",
				params: { url: "https://example.com" },
			});

			expect(response.id).toBe("cmd-1");
			expect(response.success).toBe(true);
			expect(response.data).toEqual({
				url: "https://example.com",
				title: "Example",
			});
			expect(mockController.navigate).toHaveBeenCalledWith("https://example.com");
		});

		it("returns error when url is missing", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-2",
				action: "navigate",
				params: {},
			});

			expect(response.success).toBe(false);
			expect(response.error).toContain("Missing or invalid 'url' parameter");
		});

		it("returns error when url is empty string", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-3",
				action: "navigate",
				params: { url: "" },
			});

			expect(response.success).toBe(false);
		});

		it("returns error when url is not a string", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-4",
				action: "navigate",
				params: { url: 123 },
			});

			expect(response.success).toBe(false);
		});
	});

	describe("click", () => {
		it("clicks and returns success response", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-5",
				action: "click",
				params: { selector: "#btn" },
			});

			expect(response.success).toBe(true);
			expect(mockController.click).toHaveBeenCalledWith("#btn");
		});

		it("returns error when selector is missing", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-6",
				action: "click",
				params: {},
			});

			expect(response.success).toBe(false);
			expect(response.error).toContain("Missing or invalid 'selector' parameter");
		});
	});

	describe("type", () => {
		it("types and returns success response", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-7",
				action: "type",
				params: { selector: "#input", text: "hello" },
			});

			expect(response.success).toBe(true);
			expect(mockController.type).toHaveBeenCalledWith("#input", "hello");
		});

		it("returns error when selector is missing", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-8",
				action: "type",
				params: { text: "hello" },
			});

			expect(response.success).toBe(false);
			expect(response.error).toContain("selector");
		});

		it("returns error when text is missing", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-9",
				action: "type",
				params: { selector: "#input" },
			});

			expect(response.success).toBe(false);
			expect(response.error).toContain("text");
		});
	});

	describe("getState", () => {
		it("returns page state", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-10",
				action: "getState",
			});

			expect(response.success).toBe(true);
			expect(response.data).toBeDefined();
			expect(response.data.url).toBe("https://example.com");
		});
	});

	describe("screenshot", () => {
		it("returns base64 data when screenshot returns Buffer", async () => {
			const buf = Buffer.from("fake-screenshot");
			mockController.screenshot.mockResolvedValueOnce(buf);

			const response = await handleCommand(mockController as any, {
				id: "cmd-11",
				action: "screenshot",
			});

			expect(response.success).toBe(true);
			expect(response.data.encoding).toBe("base64");
			expect(response.data.data).toBe(buf.toString("base64"));
		});

		it("returns path when screenshot returns a string", async () => {
			mockController.screenshot.mockResolvedValueOnce("/tmp/shot.png");

			const response = await handleCommand(mockController as any, {
				id: "cmd-12",
				action: "screenshot",
			});

			expect(response.success).toBe(true);
			expect(response.data.path).toBe("/tmp/shot.png");
		});

		it("passes selector to screenshot when provided", async () => {
			mockController.screenshot.mockResolvedValueOnce(Buffer.from("x"));

			await handleCommand(mockController as any, {
				id: "cmd-13",
				action: "screenshot",
				params: { selector: "#target" },
			});

			expect(mockController.screenshot).toHaveBeenCalledWith({ selector: "#target" });
		});

		it("does not pass empty options when no selector provided", async () => {
			mockController.screenshot.mockResolvedValueOnce(Buffer.from("x"));

			await handleCommand(mockController as any, {
				id: "cmd-14",
				action: "screenshot",
			});

			expect(mockController.screenshot).toHaveBeenCalledWith(undefined);
		});
	});

	describe("unknown action", () => {
		it("returns error for unknown action", async () => {
			const response = await handleCommand(mockController as any, {
				id: "cmd-15",
				action: "unknownAction",
			});

			expect(response.success).toBe(false);
			expect(response.error).toContain("Unknown action: unknownAction");
		});
	});

	describe("exception handling", () => {
		it("catches errors from controller methods", async () => {
			mockController.navigate.mockRejectedValueOnce(new Error("Browser crashed"));

			const response = await handleCommand(mockController as any, {
				id: "cmd-16",
				action: "navigate",
				params: { url: "https://example.com" },
			});

			expect(response.success).toBe(false);
			expect(response.error).toBe("Browser crashed");
		});
	});

	describe("generateSessionId", () => {
		it("returns a UUID", () => {
			const id = generateSessionId();
			expect(id).toBe("test-session-uuid");
		});
	});
});

// ─── TaloxDaemon tests ──────────────────────────────────────────────────────

describe("TaloxDaemon", () => {
	let daemon: TaloxDaemon;

	beforeEach(() => {
		vi.clearAllMocks();
		setupNetServer();
		daemon = new TaloxDaemon({ port: 9223, host: "127.0.0.1" });
	});

	afterEach(async () => {
		try {
			await daemon.stop();
		} catch {
			// Ignore errors during cleanup
		}
	});

	describe("constructor", () => {
		it("creates daemon with default config", () => {
			const d = new TaloxDaemon();
			expect(d.isRunning()).toBe(false);
		});

		it("creates daemon with custom config", () => {
			const d = new TaloxDaemon({ port: 8080, host: "0.0.0.0" });
			expect(d.isRunning()).toBe(false);
		});
	});

	describe("start", () => {
		it("starts the daemon and sets running to true", async () => {
			await daemon.start();
			expect(daemon.isRunning()).toBe(true);
		});

		it("throws if daemon is already running", async () => {
			await daemon.start();
			await expect(daemon.start()).rejects.toThrow("Daemon is already running");
		});
	});

	describe("stop", () => {
		it("stops the daemon and sets running to false", async () => {
			await daemon.start();
			await daemon.stop();
			expect(daemon.isRunning()).toBe(false);
		});

		it("is a no-op when not running", async () => {
			await expect(daemon.stop()).resolves.toBeUndefined();
		});
	});

	describe("getAddress", () => {
		it("returns empty string when not started", () => {
			expect(daemon.getAddress()).toBe("");
		});

		it("returns address after start", async () => {
			await daemon.start();
			const addr = daemon.getAddress();
			expect(addr).toBe("127.0.0.1:9222");
		});
	});

	describe("command dispatch", () => {
		// Returns the socket so tests can read socket.write after yielding to async handlers.
		async function sendCommandGetSocket(daemon: TaloxDaemon, commandLine: string) {
			await daemon.start();
			const handler = (mockNetServer as any)._connectionHandler as Function;
			const socket = createMockSocket();
			handler(socket);
			const dataHandler = socket._getDataHandler();
			dataHandler!(Buffer.from(commandLine + "\n"));
			// Yield to microtask queue so async processLine can run.
			await new Promise((r) => setTimeout(r, 30));
			return socket;
		}

		function getSocketOutput(socket: ReturnType<typeof createMockSocket>): string {
			return socket.write.mock.calls.map((c: any[]) => c[0]).join("");
		}

		it("responds to health command", async () => {
			const socket = await sendCommandGetSocket(daemon, '{"id":"h1","action":"health"}');
			const responseData = getSocketOutput(socket);
			expect(responseData).toContain('"success":true');
			expect(responseData).toContain('"status":"ok"');
		});

		it("responds to list command with empty sessions", async () => {
			const socket = await sendCommandGetSocket(daemon, '{"id":"l1","action":"list"}');
			const response = JSON.parse(getSocketOutput(socket).trim());
			expect(response.success).toBe(true);
			expect(response.data.sessions).toEqual([]);
		});

		it("responds to invalid JSON with error", async () => {
			const socket = await sendCommandGetSocket(daemon, "not-json");
			const response = JSON.parse(getSocketOutput(socket).trim());
			expect(response.success).toBe(false);
			expect(response.error).toBe("Invalid JSON");
		});

		it("responds to command missing id or action with error", async () => {
			const socket = await sendCommandGetSocket(daemon, '{"id":"x"}');
			const response = JSON.parse(getSocketOutput(socket).trim());
			expect(response.success).toBe(false);
			expect(response.error).toContain("Missing");
		});

		it("responds to launch command with session ID", async () => {
			const socket = await sendCommandGetSocket(daemon, '{"id":"launch1","action":"launch"}');
			const response = JSON.parse(getSocketOutput(socket).trim());
			expect(response.success).toBe(true);
			expect(response.data.sessionId).toBe("test-session-uuid");
		});

		it("responds to launch with custom params", async () => {
			const socket = await sendCommandGetSocket(
				daemon,
				'{"id":"launch2","action":"launch","params":{"profileId":"custom","profileClass":"qa","browser":"firefox"}}',
			);
			const response = JSON.parse(getSocketOutput(socket).trim());
			expect(response.success).toBe(true);
		});

		it("responds to stop session command", async () => {
			await daemon.start();
			const handler = (mockNetServer as any)._connectionHandler as Function;
			const socket = createMockSocket();
			handler(socket);
			const dataHandler = socket._getDataHandler();

			// Launch a session
			dataHandler!(Buffer.from('{"id":"s1","action":"launch"}\n'));
			await new Promise((r) => setTimeout(r, 50));

			// Now stop the session
			dataHandler!(Buffer.from('{"id":"s2","action":"stop","params":{"sessionId":"test-session-uuid"}}\n'));
			await new Promise((r) => setTimeout(r, 50));

			// Get the last write call (the stop response)
			const allWrites = socket.write.mock.calls.map((c: any[]) => c[0]);
			const lastWrite = allWrites[allWrites.length - 1];
			const response = JSON.parse(lastWrite.trim());
			expect(response.success).toBe(true);
			expect(response.data.stopped).toBe("test-session-uuid");
		});

		it("responds to shutdown command", async () => {
			const socket = await sendCommandGetSocket(daemon, '{"id":"sd1","action":"shutdown"}');
			const response = JSON.parse(getSocketOutput(socket).trim());
			expect(response.success).toBe(true);
			expect(response.data.message).toBe("Shutting down");
		});

		it("skips empty lines", async () => {
			const socket = await sendCommandGetSocket(daemon, "\n\n  \n");
			expect(getSocketOutput(socket)).toBe("");
		});

		it("does not write to destroyed sockets", async () => {
			await daemon.start();
			const handler = (mockNetServer as any)._connectionHandler as Function;
			const socket = createMockSocket();
			socket.destroyed = true;
			handler(socket);
			const dataHandler = socket._getDataHandler();
			dataHandler!(Buffer.from('{"id":"x1","action":"health"}\n'));
			expect(socket.write).not.toHaveBeenCalled();
		});

		it("handles socket error event", async () => {
			await daemon.start();
			const handler = (mockNetServer as any)._connectionHandler as Function;
			const socket = createMockSocket();
			handler(socket);

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const errorHandler = socket._getErrorHandler();
			expect(errorHandler).toBeDefined();
			errorHandler!(new Error("Socket error"));

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Socket error"));
			consoleSpy.mockRestore();
		});
	});

	describe("session management", () => {
		it("lists active sessions after launch", async () => {
			await daemon.start();
			const handler = (mockNetServer as any)._connectionHandler as Function;
			const socket = createMockSocket();
			handler(socket);
			const dataHandler = socket._getDataHandler();

			// Launch a session
			dataHandler!(Buffer.from('{"id":"s1","action":"launch"}\n'));
			await new Promise((r) => setTimeout(r, 50));

			// List sessions
			dataHandler!(Buffer.from('{"id":"s2","action":"list"}\n'));
			await new Promise((r) => setTimeout(r, 30));

			const allWrites = socket.write.mock.calls.map((c: any[]) => c[0]);
			const lastWrite = allWrites[allWrites.length - 1];
			const response = JSON.parse(lastWrite.trim());
			expect(response.success).toBe(true);
			expect(response.data.sessions).toHaveLength(1);
			expect(response.data.sessions[0].id).toBe("test-session-uuid");
		});

		it("returns error for stop with missing sessionId", async () => {
			const socket = await (async () => {
				await daemon.start();
				const handler = (mockNetServer as any)._connectionHandler as Function;
				const sock = createMockSocket();
				handler(sock);
				const dataHandler = sock._getDataHandler();
				dataHandler!(Buffer.from('{"id":"s1","action":"stop","params":{}}\n'));
				await new Promise((r) => setTimeout(r, 30));
				return sock;
			})();
			const response = JSON.parse(socket.write.mock.calls.map((c: any[]) => c[0]).join("").trim());
			expect(response.success).toBe(false);
			expect(response.error).toContain("Missing 'sessionId'");
		});

		it("returns error for stop with unknown sessionId", async () => {
			const socket = await (async () => {
				await daemon.start();
				const handler = (mockNetServer as any)._connectionHandler as Function;
				const sock = createMockSocket();
				handler(sock);
				const dataHandler = sock._getDataHandler();
				dataHandler!(Buffer.from('{"id":"s1","action":"stop","params":{"sessionId":"nonexistent"}}\n'));
				await new Promise((r) => setTimeout(r, 30));
				return sock;
			})();
			const response = JSON.parse(socket.write.mock.calls.map((c: any[]) => c[0]).join("").trim());
			expect(response.success).toBe(false);
			expect(response.error).toContain("Session not found");
		});

		it("handles launch failure gracefully", async () => {
			mockController.launch.mockRejectedValueOnce(new Error("Browser launch failed"));
			const socket = await (async () => {
				await daemon.start();
				const handler = (mockNetServer as any)._connectionHandler as Function;
				const sock = createMockSocket();
				handler(sock);
				const dataHandler = sock._getDataHandler();
				dataHandler!(Buffer.from('{"id":"s1","action":"launch"}\n'));
				await new Promise((r) => setTimeout(r, 50));
				return sock;
			})();
			const response = JSON.parse(socket.write.mock.calls.map((c: any[]) => c[0]).join("").trim());
			expect(response.success).toBe(false);
			expect(response.error).toBe("Browser launch failed");
		});
	});

	describe("session-scoped commands", () => {
		it("returns error when sessionId is missing for session action", async () => {
			const socket = await (async () => {
				await daemon.start();
				const handler = (mockNetServer as any)._connectionHandler as Function;
				const sock = createMockSocket();
				handler(sock);
				const dataHandler = sock._getDataHandler();
				dataHandler!(Buffer.from('{"id":"sc1","action":"navigate","params":{}}\n'));
				await new Promise((r) => setTimeout(r, 30));
				return sock;
			})();
			const response = JSON.parse(socket.write.mock.calls.map((c: any[]) => c[0]).join("").trim());
			expect(response.success).toBe(false);
			expect(response.error).toContain("Missing 'sessionId' parameter");
		});

		it("returns error for unknown session", async () => {
			const socket = await (async () => {
				await daemon.start();
				const handler = (mockNetServer as any)._connectionHandler as Function;
				const sock = createMockSocket();
				handler(sock);
				const dataHandler = sock._getDataHandler();
				dataHandler!(Buffer.from('{"id":"sc2","action":"navigate","params":{"sessionId":"nope","url":"https://example.com"}}\n'));
				await new Promise((r) => setTimeout(r, 30));
				return sock;
			})();
			const response = JSON.parse(socket.write.mock.calls.map((c: any[]) => c[0]).join("").trim());
			expect(response.success).toBe(false);
			expect(response.error).toContain("Session not found");
		});
	});
});
