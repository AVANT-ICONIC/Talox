import { afterEach, describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

describe("TaloxController HAR stop retry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("closes the browser despite a HAR write failure and retries the retained recorder", async () => {
		const controller = new TaloxController();
		const harFailure = new Error("HAR write failed");
		const recorder = {
			stop: vi
				.fn()
				.mockRejectedValueOnce(harFailure)
				.mockResolvedValue({ outputPath: "/tmp/session.har", entryCount: 3, totalDurationMs: 10 }),
		};
		(controller as any).harRecorder = recorder;
		const sessionStop = vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);

		await expect(controller.stop()).rejects.toBe(harFailure);

		expect(recorder.stop).toHaveBeenCalledTimes(1);
		expect(sessionStop).toHaveBeenCalledTimes(1);
		expect((controller as any).harRecorder).toBe(recorder);

		await expect(controller.stop()).resolves.toBeUndefined();

		expect(recorder.stop).toHaveBeenCalledTimes(2);
		expect(sessionStop).toHaveBeenCalledTimes(2);
		expect((controller as any).harRecorder).toBeNull();
	});

	it("prioritizes a session shutdown failure while retaining a failed HAR write for retry", async () => {
		const controller = new TaloxController();
		const harFailure = new Error("HAR write failed");
		const sessionFailure = new Error("browser close failed");
		const recorder = {
			stop: vi
				.fn()
				.mockRejectedValueOnce(harFailure)
				.mockResolvedValue({ outputPath: "/tmp/session.har", entryCount: 1, totalDurationMs: 0 }),
		};
		(controller as any).harRecorder = recorder;
		const sessionStop = vi
			.spyOn(controller._session, "stop")
			.mockRejectedValueOnce(sessionFailure)
			.mockResolvedValue(undefined);

		await expect(controller.stop()).rejects.toBe(sessionFailure);

		expect(recorder.stop).toHaveBeenCalledTimes(1);
		expect(sessionStop).toHaveBeenCalledTimes(1);
		expect((controller as any).harRecorder).toBe(recorder);

		await expect(controller.stop()).resolves.toBeUndefined();
		expect(recorder.stop).toHaveBeenCalledTimes(2);
		expect(sessionStop).toHaveBeenCalledTimes(2);
		expect((controller as any).harRecorder).toBeNull();
	});

	it("attempts both HAR and video finalization and retains both when they fail together", async () => {
		const controller = new TaloxController();
		const harFailure = new Error("HAR write failed");
		const videoFailure = new Error("video export failed");
		const harRecorder = {
			stop: vi
				.fn()
				.mockRejectedValueOnce(harFailure)
				.mockResolvedValue({ outputPath: "/tmp/session.har", entryCount: 2, totalDurationMs: 1 }),
		};
		const videoRecorder = {
			stop: vi.fn().mockRejectedValueOnce(videoFailure).mockResolvedValue("/tmp/session.webm"),
		};
		(controller as any).harRecorder = harRecorder;
		(controller as any).videoRecorder = videoRecorder;
		const sessionStop = vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);

		await expect(controller.stop()).rejects.toBe(harFailure);

		expect(harRecorder.stop).toHaveBeenCalledTimes(1);
		expect(videoRecorder.stop).toHaveBeenCalledTimes(1);
		expect(sessionStop).toHaveBeenCalledTimes(1);
		expect((controller as any).harRecorder).toBe(harRecorder);
		expect((controller as any).videoRecorder).toBe(videoRecorder);

		await expect(controller.stop()).resolves.toBeUndefined();

		expect(harRecorder.stop).toHaveBeenCalledTimes(2);
		expect(videoRecorder.stop).toHaveBeenCalledTimes(2);
		expect(sessionStop).toHaveBeenCalledTimes(2);
		expect((controller as any).harRecorder).toBeNull();
		expect((controller as any).videoRecorder).toBeNull();
	});
});
