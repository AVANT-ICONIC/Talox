import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

describe("TaloxController HAR context rebinding", () => {
	it("rebinds an active session HAR recorder after headed-mode recreation", async () => {
		const controller = new TaloxController(".");
		const nextContext = { id: "next-context" };
		const nextPage = { context: vi.fn(() => nextContext) };
		const recorder = {
			isRecording: vi.fn(() => true),
			startContext: vi.fn(),
		};
		(controller as any).harRecorder = recorder;

		vi.spyOn(controller._session, "setHeadedMode").mockResolvedValue(undefined);
		vi.spyOn(controller._session, "getPlaywrightPage").mockReturnValue(nextPage as any);

		await controller.setHeaded(true);

		expect(recorder.startContext).toHaveBeenCalledOnce();
		expect(recorder.startContext).toHaveBeenCalledWith(nextContext);
	});
});