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
vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "inspect-atomic-id") }));
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

function createPage(url: string, newSession: () => Promise<any>) {
	return {
		url: vi.fn(() => url),
		context: vi.fn(() => ({ newCDPSession: vi.fn(newSession) })),
	};
}

function createClient() {
	return {
		OPEN: 1,
		readyState: 1,
		send: vi.fn(),
		terminate: vi.fn(),
		close: vi.fn(),
		on: vi.fn().mockReturnThis(),
	};
}

describe("InspectServer atomic reattach", () => {
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

	it("preserves the active session when a replacement session cannot be created", async () => {
		const firstCdp = createCdpSession();
		const server = new InspectServer({ port: 9222 });
		await server.attach(createPage("https://first.example", async () => firstCdp) as any);

		const connectionHandler = mockWss.on.mock.calls.find((call: any[]) => call[0] === "connection")?.[1];
		const client = createClient();
		connectionHandler(client as any);
		const eventHandler = firstCdp.on.mock.calls.find((call: any[]) => call[0] === "event")?.[1];
		expect(eventHandler).toBeDefined();

		await expect(
			server.attach(createPage("https://second.example", async () => { throw new Error("session unavailable"); }) as any),
		).resolves.toBeUndefined();

		expect(firstCdp.off).not.toHaveBeenCalledWith("event", eventHandler);
		expect(firstCdp.detach).not.toHaveBeenCalled();

		eventHandler({ method: "Page.loadEventFired", params: { timestamp: 1 } });
		expect(client.send).toHaveBeenCalledTimes(1);

		await server.detach();
		expect(firstCdp.detach).toHaveBeenCalledTimes(1);
	});
});
