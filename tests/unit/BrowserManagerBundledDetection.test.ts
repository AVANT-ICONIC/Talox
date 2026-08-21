import { beforeEach, describe, expect, it, vi } from "vitest";

const { chromiumLaunch, chromiumClose } = vi.hoisted(() => ({
	chromiumLaunch: vi.fn(),
	chromiumClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("playwright-core", () => ({
	chromium: {
		launch: chromiumLaunch,
		executablePath: vi.fn(() => "/mock/ms-playwright/chromium/chrome"),
		launchPersistentContext: vi.fn(),
	},
	firefox: {
		launch: vi.fn().mockRejectedValue(new Error("not installed")),
		executablePath: vi.fn(() => "/mock/firefox"),
		launchPersistentContext: vi.fn(),
	},
	webkit: {
		launch: vi.fn().mockRejectedValue(new Error("not installed")),
		executablePath: vi.fn(() => "/mock/webkit"),
		launchPersistentContext: vi.fn(),
	},
}));

vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn().mockReturnValue(false),
		readdirSync: vi.fn().mockReturnValue([]),
		statSync: vi.fn(),
		accessSync: vi.fn(() => {
			throw new Error("not found");
		}),
		constants: { X_OK: 1, F_OK: 0 },
	},
}));

import { BrowserManager } from "../../src/core/BrowserManager.js";

describe("BrowserManager bundled Playwright detection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		chromiumClose.mockResolvedValue(undefined);
		chromiumLaunch.mockImplementation(async (options?: { channel?: string }) => {
			if (options?.channel) throw new Error(`channel ${options.channel} not installed`);
			return {
				close: chromiumClose,
				version: () => "147.0.0",
			};
		});
	});

	it("detects Playwright's bundled Chromium when no system browser exists", async () => {
		const manager = new BrowserManager({
			browser: { autoDetect: true, preferred: "chromium", headless: true } as any,
			settings: { virtualDisplay: false } as any,
		});

		const selected = await manager.autoDetectBrowser();
		const detected = manager.getDetectedBrowsers();

		expect(selected).toBe("chromium");
		expect(detected).toEqual([
			expect.objectContaining({
				type: "chromium",
				channel: undefined,
				executablePath: "/mock/ms-playwright/chromium/chrome",
				version: "147.0.0",
			}),
		]);
		expect(chromiumClose).toHaveBeenCalledOnce();
	});
});
