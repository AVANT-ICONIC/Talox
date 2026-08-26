import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
}));

import { writeFileSync } from "node:fs";
import { HarRecorder } from "../../src/core/HarRecorder.js";

function createPage() {
	const listeners = new Map<string, (...args: any[]) => any>();
	return {
		on: vi.fn((event: string, handler: (...args: any[]) => any) => {
			listeners.set(event, handler);
		}),
		listener: (event: string) => {
			const handler = listeners.get(event);
			if (!handler) throw new Error(`missing ${event} listener`);
			return handler;
		},
	};
}

describe("HarRecorder stop retry", () => {
	beforeEach(() => {
		vi.mocked(writeFileSync).mockReset();
	});

	it("keeps captured entries available when the first HAR write fails", async () => {
		const recorder = new HarRecorder({ outputPath: "/tmp/retry.har" });
		const page = createPage();
		recorder.start(page as any);

		const request = {
			method: vi.fn(() => "GET"),
			url: vi.fn(() => "https://example.com/data"),
			headers: vi.fn(() => ({ accept: "application/json" })),
			postData: vi.fn(() => null),
		};
		const response = {
			request: vi.fn(() => request),
			status: vi.fn(() => 200),
			statusText: vi.fn(() => "OK"),
			headers: vi.fn(() => ({ "content-type": "application/json" })),
			text: vi.fn(async () => "{}"),
		};

		page.listener("request")(request);
		await page.listener("response")(response);
		expect(recorder.getEntries()).toHaveLength(1);

		const failure = new Error("disk temporarily unavailable");
		vi.mocked(writeFileSync).mockImplementationOnce(() => {
			throw failure;
		});

		await expect(recorder.stop()).rejects.toBe(failure);
		expect(recorder.getEntries()).toHaveLength(1);
		expect(recorder.isRecording()).toBe(false);

		await expect(recorder.stop()).resolves.toMatchObject({
			outputPath: "/tmp/retry.har",
			entryCount: 1,
		});
		expect(writeFileSync).toHaveBeenCalledTimes(2);
		expect(recorder.getEntries()).toHaveLength(1);
	});
});
