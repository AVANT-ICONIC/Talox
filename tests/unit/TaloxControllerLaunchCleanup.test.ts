import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

describe("TaloxController launch cleanup", () => {
	it("cleans up when SessionManager launch fails", async () => {
		const controller = new TaloxController();
		const launchFailure = new Error("synthetic session launch failure");
		vi.spyOn(controller._session, "launch").mockRejectedValue(launchFailure);
		const sessionStop = vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);

		await expect(controller.launch("agent", "sandbox")).rejects.toBe(launchFailure);
		expect(sessionStop).toHaveBeenCalledTimes(1);
	});

	it("preserves the launch error when cleanup fails and allows a later stop retry", async () => {
		const controller = new TaloxController();
		const launchFailure = new Error("primary launch failure");
		vi.spyOn(controller._session, "launch").mockRejectedValue(launchFailure);
		const sessionStop = vi
			.spyOn(controller._session, "stop")
			.mockRejectedValueOnce(new Error("secondary cleanup failure"))
			.mockResolvedValueOnce(undefined);

		await expect(controller.launch("agent", "sandbox")).rejects.toBe(launchFailure);
		expect(sessionStop).toHaveBeenCalledTimes(1);

		await expect(controller.stop()).resolves.toBeUndefined();
		expect(sessionStop).toHaveBeenCalledTimes(2);
	});

	it("cleans up when initialization fails after the browser session started", async () => {
		const controller = new TaloxController();
		const page = {};
		vi.spyOn(controller._session, "launch").mockResolvedValue(undefined);
		vi.spyOn(controller._session, "getPlaywrightPage").mockReturnValue(page as any);
		vi.spyOn(controller._takeover, "initialize").mockResolvedValue(undefined);
		const sessionStop = vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);
		const setupFailure = new Error("synthetic inspect setup failure");
		vi.spyOn(controller as any, "setupInspectServer").mockRejectedValue(setupFailure);

		await expect(controller.launch("agent", "sandbox")).rejects.toBe(setupFailure);
		expect(sessionStop).toHaveBeenCalledTimes(1);
	});

	it("keeps the takeover initialization error prefix while using the shared cleanup path", async () => {
		const controller = new TaloxController();
		const page = {};
		vi.spyOn(controller._session, "launch").mockResolvedValue(undefined);
		vi.spyOn(controller._session, "getPlaywrightPage").mockReturnValue(page as any);
		vi.spyOn(controller._takeover, "initialize").mockRejectedValue(new Error("overlay unavailable"));
		const sessionStop = vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);

		await expect(controller.launch("agent", "sandbox")).rejects.toThrow(
			"Takeover initialization failed: overlay unavailable",
		);
		expect(sessionStop).toHaveBeenCalledTimes(1);
	});
});
