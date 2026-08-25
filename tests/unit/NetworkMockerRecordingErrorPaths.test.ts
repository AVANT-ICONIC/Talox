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
	it("does not continue a request twice when response inspection fails", async () => {
		const { mocker, getHandler } = createMocker();
		await mocker.startRecording();

		const continueRequest = vi.fn(async () => {});
		const response = vi.fn(async () => {
			throw new Error("response unavailable");
		});
		const request = createRequest({ response });

		await expect(getHandler()({ continue: continueRequest }, request)).resolves.toBeUndefined();

		expect(continueRequest).toHaveBeenCalledTimes(1);
		expect(response).toHaveBeenCalledTimes(1);
		expect(mocker.getRecordings()).toEqual([]);
	});

	it("does not continue a request twice when the recording callback throws", async () => {
		const { mocker, getHandler } = createMocker();
		const onRecording = vi.fn(() => {
			throw new Error("consumer callback failed");
		});
		await mocker.startRecording(onRecording);

		const continueRequest = vi.fn(async () => {});
		const request = createRequest();

		await expect(getHandler()({ continue: continueRequest }, request)).resolves.toBeUndefined();

		expect(continueRequest).toHaveBeenCalledTimes(1);
		expect(onRecording).toHaveBeenCalledTimes(1);
		expect(mocker.getRecordings()).toHaveLength(1);
	});

	it("surfaces a continue failure without retrying the same route", async () => {
		const { mocker, getHandler } = createMocker();
		await mocker.startRecording();

		const failure = new Error("route continue failed");
		const continueRequest = vi.fn(async () => {
			throw failure;
		});
		const response = vi.fn(async () => null);
		const request = createRequest({ response });

		await expect(getHandler()({ continue: continueRequest }, request)).rejects.toBe(failure);

		expect(continueRequest).toHaveBeenCalledTimes(1);
		expect(response).not.toHaveBeenCalled();
		expect(mocker.getRecordings()).toEqual([]);
	});
});
