import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
}));

import { writeFileSync } from "node:fs";
import { HarRecorder } from "../../src/core/HarRecorder.js";

function createEventSource() {
	const listeners = new Map<string, Array<(...args: any[]) => any>>();
	return {
		on: vi.fn((event: string, handler: (...args: any[]) => any) => {
			const current = listeners.get(event) ?? [];
			current.push(handler);
			listeners.set(event, current);
		}),
		off: vi.fn((event: string, handler: (...args: any[]) => any) => {
			listeners.set(
				event,
				(listeners.get(event) ?? []).filter((candidate) => candidate !== handler),
			);
		}),
		listeners: (event: string) => [...(listeners.get(event) ?? [])],
	};
}

function createRequest(url: string) {
	return {
		method: vi.fn(() => "GET"),
		url: vi.fn(() => url),
		headers: vi.fn(() => ({ accept: "application/json" })),
		postData: vi.fn(() => null),
	};
}

function createResponse(request: ReturnType<typeof createRequest>) {
	return {
		request: vi.fn(() => request),
		status: vi.fn(() => 200),
		statusText: vi.fn(() => "OK"),
		headers: vi.fn(() => ({ "content-type": "application/json" })),
		text: vi.fn(async () => "{}"),
	};
}

async function capture(source: ReturnType<typeof createEventSource>, url: string): Promise<void> {
	const request = createRequest(url);
	source.listeners("request")[0]!(request);
	await source.listeners("response")[0]!(createResponse(request));
}

describe("HarRecorder browser-context lifecycle", () => {
	beforeEach(() => {
		vi.mocked(writeFileSync).mockReset();
	});

	it("records context-wide traffic and preserves entries while rebinding to a replacement context", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/session-context.har" });
		const firstContext = createEventSource();
		const secondContext = createEventSource();
		const startContext = (recorder as any).startContext;

		expect(startContext).toBeTypeOf("function");
		startContext.call(recorder, firstContext);
		await capture(firstContext, "https://first.example/data");

		startContext.call(recorder, secondContext);
		expect(firstContext.listeners("request")).toEqual([]);
		expect(firstContext.listeners("response")).toEqual([]);
		expect(secondContext.listeners("request")).toHaveLength(1);
		expect(secondContext.listeners("response")).toHaveLength(1);

		await capture(secondContext, "https://second.example/data");
		const result = await recorder.stop();

		expect(result.entryCount).toBe(2);
		expect(recorder.getEntries().map((entry) => entry.request.url)).toEqual([
			"https://first.example/data",
			"https://second.example/data",
		]);
	});

	it("does not stack listeners when the same context is attached repeatedly", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/session-context-idempotent.har" });
		const context = createEventSource();
		const startContext = (recorder as any).startContext;

		expect(startContext).toBeTypeOf("function");
		startContext.call(recorder, context);
		startContext.call(recorder, context);

		expect(context.listeners("request")).toHaveLength(1);
		expect(context.listeners("response")).toHaveLength(1);

		await recorder.stop();
		expect(context.listeners("request")).toEqual([]);
		expect(context.listeners("response")).toEqual([]);
	});
});