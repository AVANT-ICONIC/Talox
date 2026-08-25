import { afterEach, describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

describe("TaloxController video stop retry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("closes the browser despite a video export failure and retries the retained recorder", async () => {
		const controller = new TaloxController();
		const videoFailure = new Error("video export failed");
		const recorder = {
			stop: vi.fn().mockRejectedValueOnce(videoFailure).mockResolvedValue("/tmp/session.webm"),
		};
		(controller as any).videoRecorder = recorder;
		const sessionStop = vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);

		await expect(controller.stop()).rejects.toBe(videoFailure);

		expect(recorder.stop).toHaveBeenCalledTimes(1);
		expect(sessionStop).toHaveBeenCalledTimes(1);
		expect((controller as any).videoRecorder).toBe(recorder);

		await expect(controller.stop()).resolves.toBeUndefined();

		expect(recorder.stop).toHaveBeenCalledTimes(2);
		expect(sessionStop).toHaveBeenCalledTimes(2);
		expect((controller as any).videoRecorder).toBeNull();
	});

	it("prioritizes a session shutdown failure while retaining a failed video export for retry", async () => {
		const controller = new TaloxController();
		const videoFailure = new Error("video export failed");
		const sessionFailure = new Error("browser close failed");
		const recorder = {
			stop: vi.fn().mockRejectedValueOnce(videoFailure).mockResolvedValue("/tmp/session.webm"),
		};
		(controller as any).videoRecorder = recorder;
		const sessionStop = vi
			.spyOn(controller._session, "stop")
			.mockRejectedValueOnce(sessionFailure)
			.mockResolvedValue(undefined);

		await expect(controller.stop()).rejects.toBe(sessionFailure);

		expect(recorder.stop).toHaveBeenCalledTimes(1);
		expect(sessionStop).toHaveBeenCalledTimes(1);
		expect((controller as any).videoRecorder).toBe(recorder);

		await expect(controller.stop()).resolves.toBeUndefined();

		expect(recorder.stop).toHaveBeenCalledTimes(2);
		expect(sessionStop).toHaveBeenCalledTimes(2);
		expect((controller as any).videoRecorder).toBeNull();
	});
});
