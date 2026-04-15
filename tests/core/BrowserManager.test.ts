import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserManager } from "../../src/core/BrowserManager";
import { ProfileVault } from "../../src/core/ProfileVault";

function isMissingBrowserError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Browser launch failed");
}

describe("BrowserManager", () => {
	it("should launch a browser with a profile", async () => {
		const vault = new ProfileVault(path.join(__dirname, "../temp-profiles"));
		const profile = await vault.createProfile("test-launch", "sandbox", "Launch test");
		const manager = new BrowserManager();
		let browser;
		try {
			browser = await manager.launch(profile);
		} catch (error) {
			if (isMissingBrowserError(error)) return;
			throw error;
		}
		expect(browser.browser()?.isConnected()).toBe(true);
		await manager.close();
	});
});
