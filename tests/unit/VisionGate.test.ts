import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock all external dependencies before importing VisionGate ─────────────
// vi.mock factories are hoisted, so we must use vi.fn() inline, not references
// to variables declared later in the file.

vi.mock("fs-extra", () => ({
	default: {
		ensureDirSync: vi.fn(),
		pathExists: vi.fn().mockResolvedValue(false),
		readFile: vi.fn().mockResolvedValue(Buffer.from("")),
		writeFile: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock("path", () => ({
	default: {
		join: vi.fn((...args: string[]) => args.join("/")),
	},
}));

vi.mock("pngjs", () => {
	const fakePng = {
		width: 16,
		height: 16,
		data: Buffer.alloc(16 * 16 * 4),
	};

	// Must use a regular function (not arrow) so `new` works
	function MockPNG(this: any, opts: { width: number; height: number }) {
		this.width = opts.width;
		this.height = opts.height;
		this.data = Buffer.alloc(opts.width * opts.height * 4);
	}
	MockPNG.sync = {
		read: vi.fn().mockReturnValue({ ...fakePng, data: Buffer.from(new Uint8Array(16 * 16 * 4)) }),
		write: vi.fn().mockReturnValue(Buffer.from("heatmap-png-data")),
	};
	return { PNG: MockPNG };
});

vi.mock("pixelmatch", () => ({
	default: vi.fn().mockReturnValue(0),
}));

vi.mock("ssim.js", () => ({
	default: vi.fn().mockReturnValue({ mssim: 1.0 }),
}));

vi.mock("tesseract.js", () => ({
	createWorker: vi.fn().mockResolvedValue({
		recognize: vi.fn().mockResolvedValue({ data: { text: "Hello World" } }),
		terminate: vi.fn().mockResolvedValue(undefined),
	}),
}));

import path from "node:path";
import fs from "fs-extra";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import ssim from "ssim.js";
import { createWorker } from "tesseract.js";
import { VisionGate } from "../../src/core/VisionGate";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFakeImage(): Buffer {
	return Buffer.from("fake-png-image-data");
}

function makeDifferentFakeImage(): Buffer {
	return Buffer.from("different-fake-png-data");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("VisionGate", () => {
	let gate: VisionGate;

	beforeEach(() => {
		vi.clearAllMocks();
		(fs.ensureDirSync as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		gate = new VisionGate("./test-baselines");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ─── Constructor ──────────────────────────────────────────────────────────

	describe("constructor", () => {
		it("creates the baseline directory on construction", () => {
			expect(fs.ensureDirSync).toHaveBeenCalledWith("./test-baselines");
		});

		it("uses default baseline directory when none provided", () => {
			new VisionGate();
			expect(fs.ensureDirSync).toHaveBeenCalledWith("./.talox/baselines");
		});
	});

	// ─── Baseline Management ─────────────────────────────────────────────────

	describe("getBaseline", () => {
		it("returns null when no baseline exists", async () => {
			(fs.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
			const result = await gate.getBaseline("nonexistent");
			expect(result).toBeNull();
			expect(fs.pathExists).toHaveBeenCalledWith(expect.stringContaining("nonexistent.png"));
		});

		it("returns buffer when baseline exists", async () => {
			const imageBuffer = Buffer.from("existing-baseline");
			(fs.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
			(fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(imageBuffer);

			const result = await gate.getBaseline("homepage");
			expect(result).toBe(imageBuffer);
			expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining("homepage.png"));
		});
	});

	describe("saveBaseline", () => {
		it("writes image buffer to the correct file path", async () => {
			const image = makeFakeImage();
			await gate.saveBaseline("login-page", image);

			expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining("login-page.png"), image);
		});

		it("can save and retrieve a baseline", async () => {
			const image = makeFakeImage();
			(fs.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
			(fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(image);

			await gate.saveBaseline("test-key", image);
			const result = await gate.getBaseline("test-key");

			expect(result).toBe(image);
		});
	});

	// ─── Pixel-Level & Structural Comparison ─────────────────────────────────

	describe("compare", () => {
		it("returns mismatchedPixels and ssimScore for identical images", async () => {
			const img = makeFakeImage();
			(pixelmatch as ReturnType<typeof vi.fn>).mockReturnValue(0);
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 1.0 });

			const result = await gate.compare(img, img);

			expect(result).toHaveProperty("mismatchedPixels", 0);
			expect(result).toHaveProperty("ssimScore", 1.0);
			expect(pixelmatch).toHaveBeenCalled();
		});

		it("detects pixel differences between images", async () => {
			(pixelmatch as ReturnType<typeof vi.fn>).mockReturnValue(42);
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 0.85 });

			const result = await gate.compare(makeFakeImage(), makeDifferentFakeImage());

			expect(result.mismatchedPixels).toBe(42);
			expect(result.ssimScore).toBe(0.85);
		});

		it("uses threshold 0.1 in pixelmatch", async () => {
			await gate.compare(makeFakeImage(), makeDifferentFakeImage());

			expect(pixelmatch).toHaveBeenCalledWith(
				expect.any(Buffer),
				expect.any(Buffer),
				expect.any(Buffer),
				expect.any(Number),
				expect.any(Number),
				{ threshold: 0.1 },
			);
		});

		it("handles ssim with different export shapes", async () => {
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 0.95 });
			const result = await gate.compare(makeFakeImage(), makeFakeImage());
			expect(result.ssimScore).toBe(0.95);
		});
	});

	// ─── Visual Regression Detection ─────────────────────────────────────────

	describe("visual regression detection", () => {
		it("flags regression when ssimScore drops below threshold", async () => {
			(pixelmatch as ReturnType<typeof vi.fn>).mockReturnValue(500);
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 0.5 });

			const result = await gate.compare(makeFakeImage(), makeDifferentFakeImage());

			expect(result.ssimScore).toBeLessThan(0.9);
			expect(result.mismatchedPixels).toBeGreaterThan(0);
		});

		it("shows perfect match for zero pixel differences", async () => {
			(pixelmatch as ReturnType<typeof vi.fn>).mockReturnValue(0);
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 1.0 });

			const result = await gate.compare(makeFakeImage(), makeFakeImage());

			expect(result.mismatchedPixels).toBe(0);
			expect(result.ssimScore).toBe(1.0);
		});
	});

	// ─── Heatmap Generation ──────────────────────────────────────────────────

	describe("generateDiffHeatmap", () => {
		it("returns a HeatmapResult with expected properties", async () => {
			const result = await gate.generateDiffHeatmap(makeFakeImage(), makeDifferentFakeImage());

			expect(result).toHaveProperty("heatmapPath");
			expect(result).toHaveProperty("regions");
			expect(result).toHaveProperty("totalDiffPixels");
			expect(result).toHaveProperty("heatmapImage");
			expect(Array.isArray(result.regions)).toBe(true);
		});

		it("writes heatmap to disk when outputPath is provided", async () => {
			await gate.generateDiffHeatmap(makeFakeImage(), makeDifferentFakeImage(), "/tmp/output-heatmap.png");

			expect(fs.writeFile).toHaveBeenCalledWith("/tmp/output-heatmap.png", expect.any(Buffer));
		});

		it("does not write file when no outputPath is given", async () => {
			await gate.generateDiffHeatmap(makeFakeImage(), makeDifferentFakeImage());

			// writeFile should NOT have been called (no outputPath)
			expect(fs.writeFile).not.toHaveBeenCalled();
		});

		it("uses custom blockSize parameter without throwing", async () => {
			const result = await gate.generateDiffHeatmap(makeFakeImage(), makeDifferentFakeImage(), undefined, 4);

			expect(result).toHaveProperty("heatmapImage");
		});

		it('generates heatmap with default path containing "heatmap_"', async () => {
			const result = await gate.generateDiffHeatmap(makeFakeImage(), makeDifferentFakeImage());

			expect(result.heatmapPath).toContain("heatmap_");
		});
	});

	// ─── compareWithHeatmap ──────────────────────────────────────────────────

	describe("compareWithHeatmap", () => {
		it("returns comparison result combined with heatmap", async () => {
			(pixelmatch as ReturnType<typeof vi.fn>).mockReturnValue(10);
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 0.9 });

			const result = await gate.compareWithHeatmap(makeFakeImage(), makeDifferentFakeImage());

			expect(result).toHaveProperty("mismatchedPixels", 10);
			expect(result).toHaveProperty("ssimScore", 0.9);
			expect(result).toHaveProperty("heatmap");
			expect(result.heatmap).toHaveProperty("regions");
			expect(result.heatmap).toHaveProperty("heatmapImage");
		});

		it("passes heatmapPath through to generateDiffHeatmap", async () => {
			await gate.compareWithHeatmap(makeFakeImage(), makeDifferentFakeImage(), "/custom/heatmap.png");

			expect(fs.writeFile).toHaveBeenCalledWith("/custom/heatmap.png", expect.any(Buffer));
		});
	});

	// ─── OCR Text Extraction ─────────────────────────────────────────────────

	describe("extractText", () => {
		it("returns recognized text from image", async () => {
			const mockWorker = {
				recognize: vi.fn().mockResolvedValue({ data: { text: "Example Domain" } }),
				terminate: vi.fn().mockResolvedValue(undefined),
			};
			(createWorker as ReturnType<typeof vi.fn>).mockResolvedValue(mockWorker);

			const text = await gate.extractText(makeFakeImage());

			expect(text).toBe("Example Domain");
			expect(createWorker).toHaveBeenCalledWith("eng");
			expect(mockWorker.recognize).toHaveBeenCalledWith(makeFakeImage());
			expect(mockWorker.terminate).toHaveBeenCalled();
		});

		it("returns empty string on OCR error", async () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			(createWorker as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Tesseract failed"));

			const text = await gate.extractText(makeFakeImage());

			expect(text).toBe("");
			expect(consoleSpy).toHaveBeenCalledWith("OCR ERROR:", expect.any(Error));
			consoleSpy.mockRestore();
		});

		it("terminates worker after successful recognition", async () => {
			const mockTerminate = vi.fn().mockResolvedValue(undefined);
			(createWorker as ReturnType<typeof vi.fn>).mockResolvedValue({
				recognize: vi.fn().mockResolvedValue({ data: { text: "some text" } }),
				terminate: mockTerminate,
			});

			await gate.extractText(makeFakeImage());

			expect(mockTerminate).toHaveBeenCalledTimes(1);
		});
	});

	// ─── Comparison Thresholds ───────────────────────────────────────────────

	describe("comparison thresholds", () => {
		it("SSIM score of 1.0 indicates identical images", async () => {
			(pixelmatch as ReturnType<typeof vi.fn>).mockReturnValue(0);
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 1.0 });

			const result = await gate.compare(makeFakeImage(), makeFakeImage());
			expect(result.ssimScore).toBeGreaterThanOrEqual(0.99);
		});

		it("high mismatch count indicates significant visual regression", async () => {
			(pixelmatch as ReturnType<typeof vi.fn>).mockReturnValue(10000);
			(ssim as ReturnType<typeof vi.fn>).mockReturnValue({ mssim: 0.3 });

			const result = await gate.compare(makeFakeImage(), makeDifferentFakeImage());
			expect(result.mismatchedPixels).toBeGreaterThan(1000);
			expect(result.ssimScore).toBeLessThan(0.5);
		});
	});
});
