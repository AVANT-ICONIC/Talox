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
vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "inspect-reattach-id") }));
vi.mock("ws", () => ({
	WebSocketServer: vi.fn().mockImplementation(function (this: any) {
		return mockWss;
	}),
	WebSocket: { OPEN: 1 },
}));
vi.mock("playwright-core", () => ({}));

import { InspectServer } from "../../src/core/inspect/InspectServer.js";

function createCdpSession() {
	return {
		on: vi.fn(),
		off: vi.fn(),
		send: vi.fn().mockResolvedValue({}),
		detach: vi.fn().mockResolvedValue(undefined),
	};
}

function createPage(cdpSession: ReturnType<typeof createCdpSession>, url: string) {
	return {
		url: vi.fn(() => url),
		context: vi.fn(() => ({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) })),
	};
}

function createClient() {
	const handlers = new Map<string, (...args: any[]) => void>();
	const client = {
		OPEN: 1,
		readyState: 1,
		send: vi.fn(),
		terminate: vi.fn(),
		close: vi.fn(),
		on: vi.fn((event: string, handler: (...args: any[]) => void) => {
			handlers.set(event, handler);
			return client;
		}),
		_emit: (event: string, ...args: any[]) => handlers.get(event)?.(...args),
	};
	return client;
}

describe("InspectServer connected client reattach", () => {
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
		mockWss.close.mockImplementation((callback?: () => void) => callback?.());
	});

	it("moves connected DevTools event subscriptions to the replacement CDP session", async () => {
		const firstCdp = createCdpSession();
		const secondCdp = createCdpSession();
		const server = new InspectServer({ port: 9222 });
		await server.attach(createPage(firstCdp, "https://first.example") as any);

		const connectionHandler = mockWss.on.mock.calls.find((call: any[]) => call[0] === "connection")?.[1];
		expect(connectionHandler).toBeDefined();
		const client = createClient();
		connectionHandler(client as any);

		const eventHandler = firstCdp.on.mock.calls.find((call: any[]) => call[0] === "event")?.[1];
		expect(eventHandler).toBeDefined();

		await server.attach(createPage(secondCdp, "https://second.example") as any);

		expect(firstCdp.off).toHaveBeenCalledWith("event", eventHandler);
		expect(firstCdp.detach).toHaveBeenCalledTimes(1);
		expect(secondCdp.on).toHaveBeenCalledWith("event", eventHandler);

		eventHandler({ method: "Page.loadEventFired", params: { timestamp: 1 } });
		expect(client.send).toHaveBeenCalledWith(
			JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 1 } }),
		);

		client._emit("close");
		expect(secondCdp.off).toHaveBeenCalledWith("event", eventHandler);
		await server.detach();
	});

	it("unbinds connected client handlers before detaching the active CDP session", async () => {
		const cdp = createCdpSession();
		const server = new InspectServer({ port: 9222 });
		await server.attach(createPage(cdp, "https://example.com") as any);

		const connectionHandler = mockWss.on.mock.calls.find((call: any[]) => call[0] === "connection")?.[1];
		const client = createClient();
		connectionHandler(client as any);
		const eventHandler = cdp.on.mock.calls.find((call: any[]) => call[0] === "event")?.[1];

		await server.detach();

		expect(cdp.off).toHaveBeenCalledWith("event", eventHandler);
		expect(cdp.detach).toHaveBeenCalledTimes(1);
		expect(client.terminate).toHaveBeenCalledTimes(1);
	});
});
