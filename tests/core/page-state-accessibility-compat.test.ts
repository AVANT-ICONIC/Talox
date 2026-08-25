import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { PageStateCollector } from "../../src/core/PageStateCollector.js";

describe("PageStateCollector · modern Playwright accessibility compatibility", () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
		page = await browser.newPage();
		await page.setContent(`<main><h1>Compatibility</h1>${Array.from({ length: 12 }, (_, i) => `<button>Action ${i}</button>`).join("")}</main>`);
	});

	afterAll(async () => {
		await browser?.close();
	});

	it("uses modern ARIA state without retrying the removed page.accessibility API", async () => {
		expect((page as any).accessibility).toBeUndefined();
		expect(typeof (page as any).ariaSnapshot).toBe("function");
		const collector = new PageStateCollector(page);

		const state = await collector.collect();
		const stats = collector.getRetryStats();

		expect(stats.axTreeAttempts).toBe(1);
		expect(stats.axTreeSuccesses).toBe(1);
		expect(stats.totalDelayMs).toBe(0);
		expect(stats.fallbackUsed).toBe(false);
		expect(state.nodes.length).toBeGreaterThanOrEqual(12);
		expect(state.interactiveElements.length).toBeGreaterThanOrEqual(12);
	});
});
