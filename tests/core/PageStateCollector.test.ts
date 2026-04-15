import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowserManager } from "../../src/core/BrowserManager";
import { PageStateCollector } from "../../src/core/PageStateCollector";
import { ProfileVault } from "../../src/core/ProfileVault";

function isMissingBrowserError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Browser launch failed");
}

describe("PageStateCollector", () => {
	it("should collect basic page state", async () => {
		const vault = new ProfileVault(path.join(__dirname, "../temp-profiles"));
		const profile = await vault.createProfile("test-state", "sandbox", "State test");
		const manager = new BrowserManager();
		let context;
		try {
			context = await manager.launch(profile);
		} catch (error) {
			if (isMissingBrowserError(error)) return;
			throw error;
		}
		const page = await context.newPage();
		await page.goto("about:blank");

		const collector = new PageStateCollector(page);
		const state = await collector.collect();
		expect(state.url).toBe("about:blank");
		expect(state.console.errors).toEqual([]);
		await manager.close();
	});
});
