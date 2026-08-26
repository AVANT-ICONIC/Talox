import { describe, expect, it, vi } from "vitest";
import { NetworkMocker } from "../../src/core/NetworkMocker.js";

type Registration = {
	pattern: string | RegExp;
	handler: (route: any, request: any) => Promise<void>;
};

function makeOwnedRoutePage() {
	const registrations: Registration[] = [];
	const page = {
		route: vi.fn(async (pattern: string | RegExp, handler: Registration["handler"]) => {
			registrations.push({ pattern, handler });
		}),
		unroute: vi.fn(async (pattern: string | RegExp, handler: Registration["handler"]) => {
			const index = registrations.findIndex(
				(entry) => entry.pattern === pattern && entry.handler === handler,
			);
			if (index >= 0) registrations.splice(index, 1);
		}),
		unrouteAll: vi.fn(async () => {
			registrations.length = 0;
		}),
		_registrations: registrations,
	};
	return page;
}

describe("NetworkMocker route ownership", () => {
	it("stopping recording removes only the recording handler", async () => {
		const page = makeOwnedRoutePage();
		const externalHandler = vi.fn(async () => {});
		await page.route("**/*", externalHandler);
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });

		await mocker.startRecording();
		await mocker.addMock({ urlPattern: "api.example.com", body: "mock" });
		expect(page._registrations).toHaveLength(3);

		await mocker.stopRecording();

		expect(page._registrations).toHaveLength(2);
		expect(page._registrations.some(({ handler }) => handler === externalHandler)).toBe(true);
		expect(
			page._registrations.some(
				({ pattern }) => pattern instanceof RegExp && pattern.test("https://api.example.com/data"),
			),
		).toBe(true);
		expect(page.unrouteAll).not.toHaveBeenCalled();
	});

	it("stopping replay does not remove recording, mocks, or external routes", async () => {
		const page = makeOwnedRoutePage();
		const externalHandler = vi.fn(async () => {});
		await page.route("**/*", externalHandler);
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });

		await mocker.startRecording();
		await mocker.startReplaying([]);
		await mocker.addMock({ urlPattern: "mock.example", body: "mock" });
		expect(page._registrations).toHaveLength(4);

		await mocker.stopReplaying();

		expect(page._registrations).toHaveLength(3);
		expect(mocker.isRecordingActive).toBe(true);
		expect(mocker.getMocks()).toHaveLength(1);
		expect(page._registrations.some(({ handler }) => handler === externalHandler)).toBe(true);
		expect(page.unrouteAll).not.toHaveBeenCalled();
	});

	it("clearMocks removes only mock-owned routes", async () => {
		const page = makeOwnedRoutePage();
		const externalHandler = vi.fn(async () => {});
		await page.route("**/*", externalHandler);
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });

		await mocker.startRecording();
		await mocker.startReplaying([]);
		await mocker.addMock({ urlPattern: "mock-a.example", body: "a" });
		await mocker.addMock({ urlPattern: "mock-b.example", body: "b" });

		await mocker.clearMocks();

		expect(mocker.getMocks()).toEqual([]);
		expect(page._registrations).toHaveLength(3);
		expect(page._registrations.some(({ handler }) => handler === externalHandler)).toBe(true);
		expect(mocker.isRecordingActive).toBe(true);
		expect(mocker.isReplayingActive).toBe(true);
		expect(page.unrouteAll).not.toHaveBeenCalled();
	});

	it("retains a mock registration when targeted unroute fails so cleanup can retry", async () => {
		const page = makeOwnedRoutePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });
		await mocker.addMock({ urlPattern: "retry.example", body: "mock" });

		const originalUnroute = page.unroute.getMockImplementation()!;
		page.unroute
			.mockRejectedValueOnce(new Error("synthetic unroute failure"))
			.mockImplementation(originalUnroute);

		await expect(mocker.clearMocks()).rejects.toThrow("synthetic unroute failure");
		expect(mocker.getMocks()).toHaveLength(1);
		expect(page._registrations).toHaveLength(1);

		await mocker.clearMocks();
		expect(mocker.getMocks()).toEqual([]);
		expect(page._registrations).toHaveLength(0);
	});

	it("start-stop-start recording does not accumulate stale recording handlers", async () => {
		const page = makeOwnedRoutePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });

		await mocker.startRecording();
		expect(page._registrations).toHaveLength(1);
		await mocker.stopRecording();
		expect(page._registrations).toHaveLength(0);
		await mocker.startRecording();

		expect(page._registrations).toHaveLength(1);
		expect(page.unrouteAll).not.toHaveBeenCalled();
	});
});
