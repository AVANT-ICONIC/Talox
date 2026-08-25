import { beforeEach, describe, expect, it, vi } from "vitest";

const { chromiumLaunch, chromiumClose, chromiumPersistentContext, firefoxLaunch, webkitLaunch } = vi.hoisted(() => ({
	chromiumLaunch: vi.fn(),
	chromiumClose: vi.fn().mockResolvedValue(undefined),
	chromiumPersistentContext: vi.fn(),
	firefoxLaunch: vi.fn(),
	webkitLaunch: vi.fn(),
}));

vi.mock("playwright-core", () => ({
	chromium: {
		launch: chromiumLaunch,
		executablePath: vi.fn(() => "/mock/ms-playwright/chromium/chrome"),
		launchPersistentContext: chromiumPersistentContext,
	},
	firefox: {
		launch: firefoxLaunch,
		executablePath: vi.fn(() => "/mock/firefox"),
		launchPersistentContext: vi.fn(),
	},
	webkit: {
		launch: webkitLaunch,
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
		chromiumPersistentContext.mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined), on: vi.fn() });
		firefoxLaunch.mockRejectedValue(new Error("not installed"));
		webkitLaunch.mockRejectedValue(new Error("not installed"));
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
	it("probes requested Chromium without launching unrelated browser detectors", async () => {
		const originalDisplay = process.env.DISPLAY;
		process.env.DISPLAY = ":talox-unit";
		try {
			const manager = new BrowserManager({
				browser: { autoDetect: true, preferred: "chromium", headless: true } as any,
				settings: { virtualDisplay: false, adaptiveStealthEnabled: false } as any,
			});
			await manager.launch({
				id: "targeted-detect", class: "sandbox", purpose: "test",
				userDataDir: "/tmp/talox-targeted-detect",
				metadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
			}, false, "chromium");
			expect(chromiumLaunch).toHaveBeenCalledTimes(1);
			expect(firefoxLaunch).not.toHaveBeenCalled();
			expect(webkitLaunch).not.toHaveBeenCalled();
			await manager.close();
		} finally {
			if (originalDisplay === undefined) delete process.env.DISPLAY;
			else process.env.DISPLAY = originalDisplay;
		}
	});

});
