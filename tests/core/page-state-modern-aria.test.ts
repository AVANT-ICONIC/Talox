import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { PageStateCollector } from "../../src/core/PageStateCollector.js";

describe("PageStateCollector · modern ARIA state", () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true, ...(process.env.CI ? { channel: "chrome" } : {}) });
		page = await browser.newPage({ viewport: { width: 900, height: 700 } });
		await page.setContent(`
			<main>
				<h1>Account</h1>
				<label for="email">Email address</label>
				<input id="email" placeholder="name@example.com" />
				<button disabled>Save</button>
				<a href="#next">Next</a>
				<iframe title="Embedded" srcdoc="<button>Inside frame</button>"></iframe>
			</main>
		`);
	});

	afterAll(async () => {
		await browser?.close();
	});

	it("collects semantic nodes with Playwright boxes without bypassing iframe trust", async () => {
		expect(typeof (page as any).ariaSnapshot).toBe("function");
		const raw = await (page as any).ariaSnapshot({ mode: "default", boxes: true });
		expect(raw).toContain("[box=");

		const collector = new PageStateCollector(page, {
			useDomFallback: false,
			domFallbackThreshold: 1,
			retry: { maxRetries: 0 },
		});
		const state = await collector.collect();

		const heading = state.nodes.find((node) => node.role === "heading" && node.name === "Account");
		const textbox = state.nodes.find((node) => node.role === "textbox" && node.name === "Email address");
		const button = state.nodes.find((node) => node.role === "button" && node.name === "Save");
		const link = state.nodes.find((node) => node.role === "link" && node.name === "Next");

		expect(heading?.attributes?.level).toBe("1");
		expect(textbox?.boundingBox.width).toBeGreaterThan(0);
		expect(button?.attributes?.disabled).toBe(true);
		expect(link?.boundingBox.width).toBeGreaterThan(0);
		expect(state.nodes.some((node) => node.name === "Inside frame")).toBe(false);
		expect(state.nodes.every((node) => Object.values(node.boundingBox).every(Number.isFinite))).toBe(true);
		expect(collector.getRetryStats()).toMatchObject({ axTreeAttempts: 1, axTreeSuccesses: 1, fallbackUsed: false });
	});
});
