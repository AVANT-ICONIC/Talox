import { describe, expect, it } from "vitest";
import { BrowserManager, DEFAULT_CONFIG } from "../../src/core/BrowserManager.js";

describe("BrowserManager nested config merging", () => {
	it("preserves sibling defaults for nested constructor overrides", () => {
		const manager = new BrowserManager({
			browser: { headless: false },
			profile: { defaultClass: "ops" },
			settings: { verbosity: 2 },
		});
		const config = manager.getConfig();

		expect(config.browser.headless).toBe(false);
		expect(config.browser.autoDetect).toBe(DEFAULT_CONFIG.browser.autoDetect);
		expect(config.browser.preferred).toBe(DEFAULT_CONFIG.browser.preferred);
		expect(config.browser.chromiumSandbox).toBe(DEFAULT_CONFIG.browser.chromiumSandbox);
		expect(config.profile.defaultClass).toBe("ops");
		expect(config.profile.vaultDir).toBe(DEFAULT_CONFIG.profile.vaultDir);
		expect(config.settings.verbosity).toBe(2);
		expect(config.settings.mouseSpeed).toBe(DEFAULT_CONFIG.settings.mouseSpeed);
	});

	it("preserves existing nested values across updateConfig calls", () => {
		const manager = new BrowserManager({
			browser: { autoDetect: false, preferred: "firefox" },
			settings: { mouseSpeed: 1.5, verbosity: 1 },
		});

		manager.updateConfig({
			browser: { headless: false },
			settings: { verbosity: 3 },
		});

		const config = manager.getConfig();
		expect(config.browser.headless).toBe(false);
		expect(config.browser.autoDetect).toBe(false);
		expect(config.browser.preferred).toBe("firefox");
		expect(config.browser.chromiumSandbox).toBe(DEFAULT_CONFIG.browser.chromiumSandbox);
		expect(config.settings.verbosity).toBe(3);
		expect(config.settings.mouseSpeed).toBe(1.5);
	});
});
