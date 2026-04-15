import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaloxController } from "../../src/core/TaloxController.js";

function isMissingBrowserError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Browser launch failed");
}

describe("VisionGate & Deterministic Verification", () => {
	let controller: TaloxController;
	const baseDir = "./tests/temp-profiles-vision";

	beforeEach(async () => {
		if (await fs.pathExists("./.talox/baselines")) {
			await fs.remove("./.talox/baselines");
		}
		controller = new TaloxController(baseDir);
	});

	afterEach(async () => {
		await controller.stop();
		if (await fs.pathExists(baseDir)) {
			await fs.remove(baseDir);
		}
		if (await fs.pathExists("./.talox/baselines")) {
			await fs.remove("./.talox/baselines");
		}
	});

	it("should auto-save a baseline and then match it", async () => {
		try {
			await controller.launch("vision-test", "qa", "chromium");
		} catch (error) {
			if (isMissingBrowserError(error)) return;
			throw error;
		}
		await controller.navigate("about:blank");

		// 1. Auto-save
		const res1 = await controller.verifyVisual("blank-page", true);
		expect(res1.isMatch).toBe(true);
		expect(res1.mismatchedPixels).toBe(0);
		expect(res1.ssimScore).toBe(1);

		// 2. Load and Match
		const res2 = await controller.verifyVisual("blank-page");
		expect(res2.isMatch).toBe(true);
		expect(res2.ssimScore).toBeGreaterThan(0.99);
	});

	it("should detect structural changes", async () => {
		try {
			await controller.launch("structural-test", "qa", "chromium");
		} catch (error) {
			if (isMissingBrowserError(error)) return;
			throw error;
		}

		// Navigate to example.com (first state)
		const state1 = await controller.navigate("https://example.com");

		// Wait for a bit
		await new Promise((r) => setTimeout(r, 500));

		// Navigate to example.com with a query param (should be identical, no structural change)
		const state2 = await controller.navigate("https://example.com?test=1");
		const structuralBugsSame = state2.bugs.filter(
			(b) => b.type === "STRUCTURAL_CHANGE" || b.type === "STRUCTURAL_REGRESSION",
		);
		expect(structuralBugsSame.length).toBe(0);

		// Navigate to a different page (should trigger structural change)
		const state3 = await controller.navigate("about:blank");
		const structuralBugsDiff = state3.bugs.filter(
			(b) => b.type === "STRUCTURAL_CHANGE" || b.type === "STRUCTURAL_REGRESSION",
		);
		expect(structuralBugsDiff.length).toBeGreaterThan(0);
	});

	it("should extract text via OCR", async () => {
		try {
			await controller.launch("ocr-test", "qa", "chromium");
		} catch (error) {
			if (isMissingBrowserError(error)) return;
			throw error;
		}
		await controller.navigate("https://example.com");

		await controller.verifyVisual("example-home", true);
		const result = await controller.verifyVisual("example-home");
		expect(result.ocrText?.toLowerCase()).toContain("example domain");
	});
});
