import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ writeFileSync: vi.fn() }));

import { HarRecorder } from "../../src/core/HarRecorder.js";

function createPage() {
	const listeners = new Map<string, Array<(value: any) => any>>();
	return {
		on: vi.fn((event: string, handler: (value: any) => any) => {
			const handlers = listeners.get(event) ?? [];
			handlers.push(handler);
			listeners.set(event, handlers);
		}),
		off: vi.fn((event: string, handler: (value: any) => any) => {
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter((candidate) => candidate !== handler),
			);
		}),
		emit: async (event: string, value: any) => {
			for (const handler of listeners.get(event) ?? []) await handler(value);
		},
	};
}

function createRequest(url: string) {
	return {
		method: vi.fn(() => "GET"),
		url: vi.fn(() => url),
		headers: vi.fn(() => ({})),
		postData: vi.fn(() => null),
	};
}

function createResponse(request: ReturnType<typeof createRequest>) {
	return {
		request: vi.fn(() => request),
		status: vi.fn(() => 200),
		statusText: vi.fn(() => "OK"),
		headers: vi.fn(() => ({ "content-type": "text/plain" })),
		text: vi.fn(async () => "ok"),
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("HarRecorder totalDurationMs", () => {
	it("includes the duration of a single request", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

		const recorder = new HarRecorder({ outputPath: "/tmp/duration.har" });
		const page = createPage();
		recorder.start(page as any);

		const request = createRequest("https://example.com/slow");
		await page.emit("request", request);
		vi.advanceTimersByTime(250);
		await page.emit("response", createResponse(request));

		const result = await recorder.stop();
		expect(result.totalDurationMs).toBe(250);
	});

	it("measures earliest request start to latest response across overlapping requests", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

		const recorder = new HarRecorder({ outputPath: "/tmp/overlap.har" });
		const page = createPage();
		recorder.start(page as any);

		const slow = createRequest("https://example.com/slow");
		await page.emit("request", slow);

		vi.advanceTimersByTime(100);
		const fast = createRequest("https://example.com/fast");
		await page.emit("request", fast);

		vi.advanceTimersByTime(100);
		await page.emit("response", createResponse(fast));

		vi.advanceTimersByTime(300);
		await page.emit("response", createResponse(slow));

		const result = await recorder.stop();
		expect(result.totalDurationMs).toBe(500);
	});
});
