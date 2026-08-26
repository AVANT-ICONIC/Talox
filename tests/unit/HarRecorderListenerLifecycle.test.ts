import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
}));

import { writeFileSync } from "node:fs";
import { HarRecorder } from "../../src/core/HarRecorder.js";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createPage() {
	const listeners = new Map<string, Array<(...args: any[]) => any>>();
	const page = {
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
	return page;
}

function createRequest(url = "https://example.com/data") {
	return {
		method: vi.fn(() => "GET"),
		url: vi.fn(() => url),
		headers: vi.fn(() => ({ accept: "application/json" })),
		postData: vi.fn(() => null),
	};
}

function createResponse(request: ReturnType<typeof createRequest>, text: () => Promise<string> = async () => "{}") {
	return {
		request: vi.fn(() => request),
		status: vi.fn(() => 200),
		statusText: vi.fn(() => "OK"),
		headers: vi.fn(() => ({ "content-type": "application/json" })),
		text: vi.fn(text),
	};
}

describe("HarRecorder listener lifecycle", () => {
	beforeEach(() => {
		vi.mocked(writeFileSync).mockReset();
	});

	it("removes exactly its owned request and response listeners on stop", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/listeners.har" });
		const page = createPage();
		recorder.start(page as any);

		const requestHandler = page.listeners("request")[0]!;
		const responseHandler = page.listeners("response")[0]!;

		await recorder.stop();

		expect(page.off).toHaveBeenCalledWith("request", requestHandler);
		expect(page.off).toHaveBeenCalledWith("response", responseHandler);
		expect(page.listeners("request")).toEqual([]);
		expect(page.listeners("response")).toEqual([]);
	});

	it("keeps stale handler references inert after stop", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/stale.har" });
		const page = createPage();
		recorder.start(page as any);
		const requestHandler = page.listeners("request")[0]!;
		const responseHandler = page.listeners("response")[0]!;

		await recorder.stop();

		const request = createRequest();
		requestHandler(request);
		await responseHandler(createResponse(request));

		expect(recorder.getEntries()).toEqual([]);
	});

	it("can restart on the same page without stacking listeners or stale pending requests", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/restart.har" });
		const page = createPage();
		recorder.start(page as any);
		const oldRequestHandler = page.listeners("request")[0]!;
		const oldResponseHandler = page.listeners("response")[0]!;
		const abandonedRequest = createRequest("https://example.com/abandoned");
		oldRequestHandler(abandonedRequest);

		await recorder.stop();
		recorder.start(page as any);

		expect(page.listeners("request")).toHaveLength(1);
		expect(page.listeners("response")).toHaveLength(1);

		await oldResponseHandler(createResponse(abandonedRequest));
		expect(recorder.getEntries()).toEqual([]);

		const request = createRequest("https://example.com/fresh");
		page.listeners("request")[0]!(request);
		await page.listeners("response")[0]!(createResponse(request));

		expect(recorder.getEntries()).toHaveLength(1);
		expect(recorder.getEntries()[0]!.request.url).toBe("https://example.com/fresh");
	});

	it("waits for an in-flight response capture before writing the HAR file", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/in-flight.har" });
		const page = createPage();
		recorder.start(page as any);

		const request = createRequest();
		page.listeners("request")[0]!(request);
		const body = deferred<string>();
		const responseCapture = page.listeners("response")[0]!(createResponse(request, () => body.promise));

		const stop = recorder.stop();
		await Promise.resolve();
		expect(writeFileSync).not.toHaveBeenCalled();

		body.resolve('{"done":true}');
		await responseCapture;
		const result = await stop;

		expect(result.entryCount).toBe(1);
		expect(writeFileSync).toHaveBeenCalledTimes(1);
		const har = JSON.parse(vi.mocked(writeFileSync).mock.calls[0]![1] as string);
		expect(har.log.entries).toHaveLength(1);
		expect(har.log.entries[0].response.content.text).toBe('{"done":true}');
	});

	it("retains a listener whose removal fails and retries cleanup on a later stop", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/off-retry.har" });
		const page = createPage();
		recorder.start(page as any);
		const requestHandler = page.listeners("request")[0]!;
		const failure = new Error("request listener removal failed");
		page.off.mockImplementationOnce((event: string, handler: (...args: any[]) => any) => {
			if (event === "request") throw failure;
			page.listeners(event).filter((candidate) => candidate !== handler);
		});

		await expect(recorder.stop()).rejects.toBe(failure);

		expect(writeFileSync).toHaveBeenCalledTimes(1);
		expect(page.listeners("request")).toContain(requestHandler);
		expect(page.listeners("response")).toEqual([]);
		expect(() => recorder.start(page as any)).toThrow("previous page listeners await cleanup");

		await expect(recorder.stop()).resolves.toMatchObject({ outputPath: "/tmp/off-retry.har" });
		expect(writeFileSync).toHaveBeenCalledTimes(2);
		expect(page.listeners("request")).toEqual([]);

		expect(() => recorder.start(page as any)).not.toThrow();
	});
});
