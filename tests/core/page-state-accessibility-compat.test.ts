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

	it("does not retry the removed page.accessibility API before DOM fallback", async () => {
		expect((page as any).accessibility).toBeUndefined();
		const collector = new PageStateCollector(page);

		const state = await collector.collect();
		const stats = collector.getRetryStats();

		expect(stats.axTreeAttempts).toBe(0);
		expect(stats.totalDelayMs).toBe(0);
		expect(state.nodes.length).toBeGreaterThanOrEqual(12);
		expect(state.interactiveElements.length).toBeGreaterThanOrEqual(12);
	});
});
