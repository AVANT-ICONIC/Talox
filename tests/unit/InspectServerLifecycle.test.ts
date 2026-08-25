import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHttpServer, mockWss, mockCreateServer } = vi.hoisted(() => {
	const mockHttpServer = {
		listen: vi.fn(),
		close: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	};
	const mockWss = {
		on: vi.fn(),
		close: vi.fn(),
	};
	const mockCreateServer = vi.fn(() => mockHttpServer);
	return { mockHttpServer, mockWss, mockCreateServer };
});

vi.mock("node:http", () => ({ createServer: mockCreateServer }));
vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "inspect-lifecycle-id") }));
vi.mock("ws", () => ({
	WebSocketServer: vi.fn().mockImplementation(function (this: any) {
		return mockWss;
	}),
	WebSocket: { OPEN: 1 },
}));
vi.mock("playwright-core", () => ({}));

import { InspectServer } from "../../src/core/inspect/InspectServer.js";

function createPage() {
	const cdpSession = {
		on: vi.fn(),
		off: vi.fn(),
		send: vi.fn().mockResolvedValue({}),
		detach: vi.fn().mockResolvedValue(undefined),
	};
	return {
		url: vi.fn(() => "https://example.com"),
		context: vi.fn(() => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) })),
		_cdpSession: cdpSession,
	};
}

describe("InspectServer lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockHttpServer.once.mockReturnValue(mockHttpServer);
		mockHttpServer.removeListener.mockReturnValue(mockHttpServer);
		mockHttpServer.listen.mockImplementation((_port: number, _host: string, callback: () => void) => {
			callback();
			return mockHttpServer;
		});
		mockHttpServer.close.mockImplementation((callback?: () => void) => {
			callback?.();
			return mockHttpServer;
		});
		mockWss.on.mockReturnValue(mockWss);
		mockWss.close.mockImplementation((callback?: () => void) => {
			callback?.();
		});
	});

	it("can retry after the first listen attempt fails", async () => {
		const server = new InspectServer({ port: 9222 });
		const page = createPage();
		const failure = new Error("EADDRINUSE");
		let errorHandler: ((error: Error) => void) | undefined;

		mockHttpServer.once.mockImplementation((event: string, handler: (error: Error) => void) => {
			if (event === "error") errorHandler = handler;
			return mockHttpServer;
		});
		mockHttpServer.listen.mockImplementationOnce(() => {
			errorHandler?.(failure);
			return mockHttpServer;
		});

		await expect(server.attach(page as any)).rejects.toBe(failure);
		await expect(server.attach(page as any)).resolves.toBeUndefined();

		expect(mockHttpServer.listen).toHaveBeenCalledTimes(2);
		expect(mockWss.on).toHaveBeenCalledTimes(1);
	});

	it("shares one listen attempt across concurrent attach callers", async () => {
		const server = new InspectServer({ port: 9222 });
		const page = createPage();
		let listenCallback: (() => void) | undefined;
		mockHttpServer.listen.mockImplementation((_port: number, _host: string, callback: () => void) => {
			listenCallback = callback;
			return mockHttpServer;
		});

		const first = server.attach(page as any);
		const second = server.attach(page as any);
		await vi.waitFor(() => expect(mockHttpServer.listen).toHaveBeenCalledTimes(1));

		listenCallback?.();
		await Promise.all([first, second]);

		expect(mockHttpServer.listen).toHaveBeenCalledTimes(1);
		expect(mockWss.on).toHaveBeenCalledTimes(1);
	});

	it("does not resolve detach until WebSocket and HTTP close callbacks complete", async () => {
		const server = new InspectServer({ port: 9222 });
		const page = createPage();
		await server.attach(page as any);

		let wsClosed: (() => void) | undefined;
		let httpClosed: (() => void) | undefined;
		mockWss.close.mockImplementation((callback?: () => void) => {
			wsClosed = callback;
		});
		mockHttpServer.close.mockImplementation((callback?: () => void) => {
			httpClosed = callback;
			return mockHttpServer;
		});

		let resolved = false;
		const detach = server.detach().then(() => {
			resolved = true;
		});
		await vi.waitFor(() => expect(mockHttpServer.close).toHaveBeenCalledTimes(1));
		expect(resolved).toBe(false);

		wsClosed?.();
		await Promise.resolve();
		expect(resolved).toBe(false);

		httpClosed?.();
		await detach;
		expect(resolved).toBe(true);
	});
});
