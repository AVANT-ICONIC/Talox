import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockResponse, NetworkRecording } from "../../src/core/NetworkMocker";
import { createNetworkMocker, NetworkMocker } from "../../src/core/NetworkMocker";

function makeMockPage() {
	const handlers: Array<(route: any, request: any) => Promise<void>> = [];

	return {
		route: vi.fn(async (_pattern: string | RegExp, handler: (route: any, request: any) => Promise<void>) => {
			handlers.push(handler);
		}),
		unroute: vi.fn(async (_pattern: string | RegExp, handler: (route: any, request: any) => Promise<void>) => {
			const index = handlers.indexOf(handler);
			if (index >= 0) handlers.splice(index, 1);
		}),
		unrouteAll: vi.fn(async () => {
			handlers.length = 0;
		}),
		_handlers: handlers,
	};
}

function makeMockContext() {
	return {};
}

function makeRoute(overrides: Record<string, any> = {}) {
	return {
		continue: vi.fn(async () => {}),
		fallback: vi.fn(async () => {}),
		fulfill: vi.fn(async () => {}),
		...overrides,
	};
}

function makeRequest(overrides: Record<string, any> = {}) {
	return {
		url: vi.fn(() => "https://api.example.com/data"),
		method: vi.fn(() => "GET"),
		headers: vi.fn(() => ({ "content-type": "application/json" })),
		postDataBuffer: vi.fn(() => null),
		response: vi.fn(async () => null),
		...overrides,
	};
}

describe("NetworkMocker", () => {
	let mocker: NetworkMocker;
	let mockPage: ReturnType<typeof makeMockPage>;
	let mockContext: ReturnType<typeof makeMockContext>;

	beforeEach(() => {
		mockPage = makeMockPage();
		mockContext = makeMockContext();
		mocker = new NetworkMocker({ context: mockContext as any, page: mockPage as any });
	});

	describe("constructor + factory", () => {
		it("creates instance with required options", () => {
			expect(mocker).toBeInstanceOf(NetworkMocker);
		});

		it("factory creates instance", () => {
			const m = createNetworkMocker({ context: mockContext as any, page: mockPage as any });
			expect(m).toBeInstanceOf(NetworkMocker);
		});

		it("starts with no recordings and not active", () => {
			expect(mocker.getRecordings()).toEqual([]);
			expect(mocker.isRecordingActive).toBe(false);
			expect(mocker.isReplayingActive).toBe(false);
		});
	});

	describe("startRecording / stopRecording", () => {
		it("registers a route handler on page", async () => {
			await mocker.startRecording();
			expect(mockPage.route).toHaveBeenCalledWith("**/*", expect.any(Function));
			expect(mocker.isRecordingActive).toBe(true);
		});

		it("does not double-start recording", async () => {
			await mocker.startRecording();
			await mocker.startRecording();
			expect(mockPage.route).toHaveBeenCalledTimes(1);
		});

		it("stopRecording returns recordings and resets state", async () => {
			await mocker.startRecording();
			const recordings = await mocker.stopRecording();
			expect(recordings).toEqual([]);
			expect(mocker.isRecordingActive).toBe(false);
			expect(mockPage.unroute).toHaveBeenCalledWith("**/*", expect.any(Function));
		});
	});

	describe("recording handler captures request data", () => {
		it("records a request while falling through to earlier routes", async () => {
			const onRecording = vi.fn();
			await mocker.startRecording(onRecording);
			const handler = mockPage._handlers[0]!;

			const route = makeRoute();
			const response = {
				status: vi.fn(() => 200),
				headers: vi.fn(() => ({ "content-type": "text/html" })),
				body: vi.fn(async () => Buffer.from("ok")),
			};
			const request = makeRequest({
				response: vi.fn(async () => response),
				url: vi.fn(() => "https://example.com/page"),
				method: vi.fn(() => "GET"),
				headers: vi.fn(() => ({ accept: "*/*" })),
			});

			await handler(route, request);

			expect(route.fallback).toHaveBeenCalled();
			expect(route.continue).not.toHaveBeenCalled();
			const recordings = mocker.getRecordings();
			expect(recordings).toHaveLength(1);
			expect(recordings[0]!.url).toBe("https://example.com/page");
			expect(recordings[0]!.method).toBe("GET");
			expect(recordings[0]!.status).toBe(200);
			expect(onRecording).toHaveBeenCalledWith(recordings[0]);
		});

		it("records request body from POST", async () => {
			await mocker.startRecording();
			const handler = mockPage._handlers[0]!;

			const route = makeRoute();
			const request = makeRequest({
				method: vi.fn(() => "POST"),
				postDataBuffer: vi.fn(() => Buffer.from('{"key":"value"}')),
				response: vi.fn(async () => null),
			});

			await handler(route, request);

			const recordings = mocker.getRecordings();
			expect(recordings).toHaveLength(1);
			expect(recordings[0]!.requestBody).toBe('{"key":"value"}');
		});

		it("falls through when a stale recording handler is called after stop", async () => {
			await mocker.startRecording();
			const handler = mockPage._handlers[0]!;

			await mocker.stopRecording();

			const route = makeRoute();
			const request = makeRequest();
			await handler(route, request);

			expect(mocker.getRecordings()).toEqual([]);
			expect(route.fallback).toHaveBeenCalled();
			expect(route.continue).not.toHaveBeenCalled();
		});
	});

	describe("startReplaying / stopReplaying", () => {
		it("replays recorded responses", async () => {
			const recordings: NetworkRecording[] = [
				{
					id: "test-1",
					url: "https://api.example.com/data",
					method: "GET",
					status: 200,
					requestHeaders: {},
					responseHeaders: { "content-type": "application/json" },
					responseBody: '{"result":true}',
					timestamp: Date.now(),
				},
			];

			await mocker.startReplaying(recordings);
			expect(mocker.isReplayingActive).toBe(true);

			const handler = mockPage._handlers[mockPage._handlers.length - 1]!;
			const route = makeRoute();
			const request = makeRequest({
				url: vi.fn(() => "https://api.example.com/data"),
				method: vi.fn(() => "GET"),
			});

			await handler(route, request);

			expect(route.fulfill).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 200,
					body: '{"result":true}',
				}),
			);
			expect(route.fallback).not.toHaveBeenCalled();
		});

		it("falls through when no recording matches", async () => {
			await mocker.startReplaying([]);
			const handler = mockPage._handlers[mockPage._handlers.length - 1]!;

			const route = makeRoute();
			const request = makeRequest({
				url: vi.fn(() => "https://unknown.com"),
				method: vi.fn(() => "GET"),
			});

			await handler(route, request);
			expect(route.fallback).toHaveBeenCalled();
			expect(route.continue).not.toHaveBeenCalled();
		});

		it("stopReplaying resets state", async () => {
			await mocker.startReplaying();
			await mocker.stopReplaying();
			expect(mocker.isReplayingActive).toBe(false);
			expect(mockPage.unroute).toHaveBeenCalledWith("**/*", expect.any(Function));
		});

		it("does not double-start replaying", async () => {
			await mocker.startReplaying();
			await mocker.startReplaying();
			expect(mockPage.route).toHaveBeenCalledTimes(1);
		});
	});

	describe("addMock / clearMocks / getMocks", () => {
		it("adds a mock and registers a substring route", async () => {
			const mock: MockResponse = {
				urlPattern: "api.example.com",
				status: 200,
				body: '{"mocked":true}',
			};
			await mocker.addMock(mock);

			expect(mocker.getMocks()).toHaveLength(1);
			const routePattern = mockPage.route.mock.calls[0]?.[0];
			expect(routePattern).toBeInstanceOf(RegExp);
			expect((routePattern as RegExp).test("https://api.example.com/data")).toBe(true);
		});

		it("falls through instead of terminating the route chain when a mock does not match", async () => {
			await mocker.addMock({ urlPattern: "api.example.com", status: 200 });
			const handler = mockPage._handlers[0]!;
			const route = makeRoute();
			const request = makeRequest({ url: vi.fn(() => "https://other.example.com/data") });

			await handler(route, request);

			expect(route.fallback).toHaveBeenCalled();
			expect(route.fulfill).not.toHaveBeenCalled();
			expect(route.continue).not.toHaveBeenCalled();
		});

		it("clears all mocks", async () => {
			await mocker.addMock({ urlPattern: "**/api/**", status: 200 });
			await mocker.addMock({ urlPattern: "**/data/**", status: 404 });
			await mocker.clearMocks();
			expect(mocker.getMocks()).toEqual([]);
			expect(mockPage.unroute).toHaveBeenCalledTimes(2);
			expect(mockPage.unrouteAll).not.toHaveBeenCalled();
		});
	});

	describe("saveToFile / loadFromFile", () => {
		it("saves recordings to file", async () => {
			vi.doMock("fs/promises", () => ({
				writeFile: vi.fn().mockResolvedValue(undefined),
				readFile: vi.fn().mockResolvedValue("[]"),
			}));

			await mocker.startRecording();
			const handler = mockPage._handlers[0]!;

			const route = makeRoute();
			const response = {
				status: vi.fn(() => 200),
				headers: vi.fn(() => ({})),
				body: vi.fn(async () => Buffer.from("ok")),
			};
			const request = makeRequest({ response: vi.fn(async () => response) });
			await handler(route, request);
			await mocker.stopRecording();

			const fs = await import("node:fs/promises");
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);
			await mocker.saveToFile("/tmp/recordings.json");
			expect(fs.writeFile).toHaveBeenCalled();
		});

		it("loads recordings from file", async () => {
			const fs = await import("node:fs/promises");
			const data = JSON.stringify([{ id: "1", url: "https://example.com" }]);
			vi.mocked(fs.readFile).mockResolvedValue(data);

			const result = await mocker.loadFromFile("/tmp/test-recordings.json");
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("1");
			expect(mocker.getRecordings()).toEqual(result);
		});
	});

	describe("destroy", () => {
		it("stops recording, replaying, and clears mocks", async () => {
			await mocker.startRecording();
			await mocker.destroy();
			expect(mocker.isRecordingActive).toBe(false);
			expect(mocker.isReplayingActive).toBe(false);
			expect(mocker.getRecordings()).toEqual([]);
			expect(mocker.getMocks()).toEqual([]);
		});
	});
});
