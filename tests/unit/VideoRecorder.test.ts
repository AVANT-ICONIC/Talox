import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before import
vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:path", () => ({
	default: {
		resolve: vi.fn((p: string) => p),
		dirname: vi.fn((p: string) => p.replace(/\/[^/]+$/, "")),
		join: vi.fn((...args: string[]) => args.join("/")),
	},
	resolve: vi.fn((p: string) => p),
	dirname: vi.fn((p: string) => p.replace(/\/[^/]+$/, "")),
	join: vi.fn((...args: string[]) => args.join("/")),
}));

import { execFile } from "node:child_process";
import { VideoRecorder } from "../../src/core/VideoRecorder";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockPage(screenshotBuffer?: Buffer) {
	return {
		screenshot: vi.fn().mockResolvedValue(screenshotBuffer ?? Buffer.from("fake-png-data")),
	} as any;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("VideoRecorder", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(execFile).mockImplementation((_cmd: string, _args: string[], cb: (...args: any[]) => any) => {
			// Mock ffmpeg check: first call is -version check
			const proc = {
				stdin: {
					write: vi.fn().mockReturnValue(true),
					end: vi.fn(),
					on: vi.fn(),
				},
			};
			cb(null);
			return proc as any;
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("uses default fps and format", () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm" });
			expect(vr.isRecording()).toBe(false);
			expect(vr.getFrameCount()).toBe(0);
		});

		it("accepts custom fps and format", () => {
			const vr = new VideoRecorder({
				outputPath: "/tmp/test.mp4",
				fps: 30,
				format: "mp4",
			});
			expect(vr.isRecording()).toBe(false);
		});
	});

	describe("start / stop lifecycle", () => {
		it("start sets recording to true", () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm" });
			const page = createMockPage();
			vr.start(page);
			expect(vr.isRecording()).toBe(true);
		});

		it("start is idempotent", () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm" });
			const page = createMockPage();
			vr.start(page);
			vr.start(page);
			expect(vr.isRecording()).toBe(true);
		});

		it("stop sets recording to false", async () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm" });
			const page = createMockPage();
			vr.start(page);
			const output = await vr.stop();
			expect(vr.isRecording()).toBe(false);
			expect(output).toBe("/tmp/test.webm");
		});

		it("stop with no frames creates empty file", async () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm" });
			const page = createMockPage();
			vr.start(page);
			await vr.stop();
			// Frame count was 0 at stop time
			const { writeFile } = await import("node:fs/promises");
			expect(writeFile).toHaveBeenCalled();
		});

		it("stop clears interval", async () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm", fps: 10 });
			const page = createMockPage();
			vr.start(page);

			// Advance timer a few times to capture frames
			await vi.advanceTimersByTimeAsync(500);

			await vr.stop();
			expect(vr.isRecording()).toBe(false);
		});
	});

	describe("frame counting", () => {
		it("captures frames at configured FPS", async () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm", fps: 10 });
			const page = createMockPage();

			vr.start(page);

			// At 10fps, interval is 100ms
			// Advance 350ms → should capture ~3 frames
			await vi.advanceTimersByTimeAsync(350);

			expect(vr.getFrameCount()).toBeGreaterThanOrEqual(3);
			expect(page.screenshot).toHaveBeenCalled();
		});

		it("stops counting after stop", async () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm", fps: 10 });
			const page = createMockPage();

			vr.start(page);
			await vi.advanceTimersByTimeAsync(200);
			const countBefore = vr.getFrameCount();
			expect(countBefore).toBeGreaterThan(0);

			await vr.stop();
			// stop() clears frames after encoding
			expect(vr.getFrameCount()).toBe(0);

			// No more frames captured after stop
			await vi.advanceTimersByTimeAsync(200);
			expect(vr.getFrameCount()).toBe(0);
		});

		it("handles screenshot errors gracefully", async () => {
			const vr = new VideoRecorder({ outputPath: "/tmp/test.webm", fps: 10 });
			const page = createMockPage();
			page.screenshot.mockRejectedValue(new Error("Page closed"));

			vr.start(page);

			// Should not throw even though screenshots fail
			await vi.advanceTimersByTimeAsync(200);
			expect(vr.isRecording()).toBe(true);
			expect(vr.getFrameCount()).toBe(0);
		});
	});
});
