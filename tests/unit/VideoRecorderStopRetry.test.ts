import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { execFile } from "node:child_process";
import { VideoRecorder } from "../../src/core/VideoRecorder.js";

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
	return {
		screenshot: vi.fn().mockResolvedValue(Buffer.from("frame")),
	} as any;
}

describe("VideoRecorder stop retry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(execFile).mockImplementation((_cmd: string, _args: string[], cb: (...args: any[]) => any) => {
			cb(null);
			return {
				stdin: {
					write: vi.fn().mockReturnValue(true),
					end: vi.fn(),
					on: vi.fn(),
				},
			} as any;
		});
	});

	it("retains captured frames after an export failure and retries finalization", async () => {
		const recorder = new VideoRecorder({ outputPath: "/tmp/retry.webm", fps: 10 });
		const page = createPage();
		recorder.start(page);
		await vi.advanceTimersByTimeAsync(120);
		expect(recorder.getFrameCount()).toBeGreaterThan(0);

		const failure = new Error("ffmpeg export failed");
		const encode = vi
			.spyOn(recorder as any, "encodeWithFfmpeg")
			.mockRejectedValueOnce(failure)
			.mockResolvedValue(undefined);

		await expect(recorder.stop()).rejects.toBe(failure);

		expect(recorder.isRecording()).toBe(false);
		expect(recorder.getFrameCount()).toBeGreaterThan(0);
		expect(() => recorder.start(createPage())).toThrow("previous recording awaits finalization");

		await expect(recorder.stop()).resolves.toBe("/tmp/retry.webm");
		expect(encode).toHaveBeenCalledTimes(2);
		expect(recorder.getFrameCount()).toBe(0);
	});

	it("shares one in-flight export across concurrent stop callers", async () => {
		const recorder = new VideoRecorder({ outputPath: "/tmp/concurrent.webm", fps: 10 });
		recorder.start(createPage());
		await vi.advanceTimersByTimeAsync(120);

		const gate = deferred<void>();
		const encode = vi.spyOn(recorder as any, "encodeWithFfmpeg").mockImplementation(() => gate.promise);

		const firstStop = recorder.stop();
		const secondStop = recorder.stop();
		expect(secondStop).toBe(firstStop);
		await vi.waitFor(() => expect(encode).toHaveBeenCalledTimes(1));

		gate.resolve();
		await Promise.all([firstStop, secondStop]);

		expect(encode).toHaveBeenCalledTimes(1);
		expect(recorder.getFrameCount()).toBe(0);
	});
});
