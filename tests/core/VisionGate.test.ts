import fs from "fs-extra";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import { VisionGate } from "../../src/core/VisionGate.js";
import { type FixtureServer, startFixtureServer } from "../e2e/helpers.js";

function isMissingBrowserError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Browser launch failed");
}

describe("VisionGate & Deterministic Verification", () => {
	let controller: TaloxController;
	let server: FixtureServer;
	const baseDir = "./tests/temp-profiles-vision";

	beforeAll(async () => {
		server = await startFixtureServer();
	});

	beforeEach(async () => {
		if (await fs.pathExists("./.talox/baselines")) {
			await fs.remove("./.talox/baselines");
		}
		controller = new TaloxController(baseDir);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await controller.stop();
		if (await fs.pathExists(baseDir)) {
			await fs.remove(baseDir);
		}
		if (await fs.pathExists("./.talox/baselines")) {
			await fs.remove("./.talox/baselines");
		}
	});

	afterAll(async () => {
		await server.close();
	});

	function fixtureUrl(file: string): string {
		return `${server.url}/${file}`;
	}

	it("should auto-save a baseline and then match it", async () => {
		try {
			await controller.launch("vision-test", "qa", "chromium");
		} catch (error) {
			if (isMissingBrowserError(error)) return;
			throw error;
		}
		await controller.navigate("about:blank");

		// This test covers screenshot persistence and deterministic image comparison.
		// OCR has its own real integration case below; avoid paying Tesseract startup
		// cost here for a value this assertion does not use.
		vi.spyOn(VisionGate.prototype, "extractText").mockResolvedValue("");

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

		// Establish a synthetic first navigation so the real-site human warmup does
		// not distort a deterministic localhost integration test.
		await controller.navigate("about:blank");

		const pageA = fixtureUrl("navigation.html");
		const pageB = fixtureUrl("navigation-b.html");

		// First local fixture state.
		await controller.navigate(pageA);

		// Same fixture with a query param should remain structurally identical.
		const state2 = await controller.navigate(`${pageA}?test=1`);
		const structuralBugsSame = state2.bugs.filter(
			(b) => b.type === "STRUCTURAL_CHANGE" || b.type === "STRUCTURAL_REGRESSION",
		);
		expect(structuralBugsSame.length).toBe(0);

		// A fixture with a removed interactive link should trigger structural change.
		const state3 = await controller.navigate(pageB);
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

		// Keep the OCR integration real while removing external-network variance.
		await controller.navigate("about:blank");
		await controller.navigate(fixtureUrl("navigation.html"));

		await controller.verifyVisual("navigation-page", true);
		const result = await controller.verifyVisual("navigation-page");
		expect(result.ocrText?.toLowerCase()).toContain("navigation");
	});
});
