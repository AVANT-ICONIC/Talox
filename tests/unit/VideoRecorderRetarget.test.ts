import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { VideoRecorder } from "../../src/core/VideoRecorder.js";

function createPage(label: string) {
	return {
		screenshot: vi.fn().mockResolvedValue(Buffer.from(label)),
	} as any;
}

describe("VideoRecorder retargeting", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("continues the same recording while frame capture moves to a replacement page", async () => {
		const recorder = new VideoRecorder({ outputPath: "/tmp/session.webm", fps: 10 });
		const firstPage = createPage("first");
		const secondPage = createPage("second");

		recorder.start(firstPage);
		await vi.advanceTimersByTimeAsync(100);
		const beforeRetarget = recorder.getFrameCount();

		expect((recorder as any).retarget).toBeTypeOf("function");
		(recorder as any).retarget(secondPage);
		await vi.advanceTimersByTimeAsync(100);

		expect(firstPage.screenshot).toHaveBeenCalledOnce();
		expect(secondPage.screenshot).toHaveBeenCalledOnce();
		expect(recorder.getFrameCount()).toBe(beforeRetarget + 1);
		expect(recorder.isRecording()).toBe(true);
	});

	it("can pause frame capture with a null page without ending or resetting the recording", async () => {
		const recorder = new VideoRecorder({ outputPath: "/tmp/session.webm", fps: 10 });
		const page = createPage("active");

		recorder.start(page);
		await vi.advanceTimersByTimeAsync(100);
		const captured = recorder.getFrameCount();

		expect((recorder as any).retarget).toBeTypeOf("function");
		(recorder as any).retarget(null);
		await vi.advanceTimersByTimeAsync(300);

		expect(recorder.getFrameCount()).toBe(captured);
		expect(recorder.isRecording()).toBe(true);
	});
});