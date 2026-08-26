import { describe, expect, it, vi } from "vitest";
import { NetworkMocker } from "../../src/core/NetworkMocker.js";

type RouteHandler = (route: any, request: any) => Promise<void>;

function createMocker() {
	let handler: RouteHandler | null = null;
	const page = {
		route: vi.fn(async (_pattern: string, registeredHandler: RouteHandler) => {
			handler = registeredHandler;
		}),
		unroute: vi.fn(async () => {}),
	};
	const mocker = new NetworkMocker({ context: {} as any, page: page as any });
	return {
		mocker,
		page,
		getHandler: () => {
			if (!handler) throw new Error("recording route was not registered");
			return handler;
		},
	};
}

function createRequest(overrides: Record<string, unknown> = {}) {
	return {
		response: vi.fn(async () => null),
		postDataBuffer: vi.fn(() => null),
		url: vi.fn(() => "https://example.com/data"),
		method: vi.fn(() => "GET"),
		headers: vi.fn(() => ({ accept: "*/*" })),
		...overrides,
	};
}

describe("NetworkMocker recording route error paths", () => {
	it("does not fall through a request twice when response inspection fails", async () => {
		const { mocker, getHandler } = createMocker();
		await mocker.startRecording();

		const fallbackRequest = vi.fn(async () => {});
		const response = vi.fn(async () => {
			throw new Error("response unavailable");
		});
		const request = createRequest({ response });

		await expect(getHandler()({ fallback: fallbackRequest }, request)).resolves.toBeUndefined();

		expect(fallbackRequest).toHaveBeenCalledTimes(1);
		expect(response).toHaveBeenCalledTimes(1);
		expect(mocker.getRecordings()).toEqual([]);
	});

	it("does not fall through a request twice when the recording callback throws", async () => {
		const { mocker, getHandler } = createMocker();
		const onRecording = vi.fn(() => {
			throw new Error("consumer callback failed");
		});
		await mocker.startRecording(onRecording);

		const fallbackRequest = vi.fn(async () => {});
		const request = createRequest();

		await expect(getHandler()({ fallback: fallbackRequest }, request)).resolves.toBeUndefined();

		expect(fallbackRequest).toHaveBeenCalledTimes(1);
		expect(onRecording).toHaveBeenCalledTimes(1);
		expect(mocker.getRecordings()).toHaveLength(1);
	});

	it("surfaces a fallback failure without inspecting or retrying the same route", async () => {
		const { mocker, getHandler } = createMocker();
		await mocker.startRecording();

		const failure = new Error("route fallback failed");
		const fallbackRequest = vi.fn(async () => {
			throw failure;
		});
		const response = vi.fn(async () => null);
		const request = createRequest({ response });

		await expect(getHandler()({ fallback: fallbackRequest }, request)).rejects.toBe(failure);

		expect(fallbackRequest).toHaveBeenCalledTimes(1);
		expect(response).not.toHaveBeenCalled();
		expect(mocker.getRecordings()).toEqual([]);
	});
});
