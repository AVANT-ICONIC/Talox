/**
 * @file error-paths.test.ts
 * @description Error-path integration tests with real browser.
 * Tests resilience to: network timeouts, browser crashes, concurrent sessions,
 * invalid selectors, invalid URLs, and post-navigation state queries.
 *
 * KEY INSIGHT: TaloxController is designed to be resilient — it catches errors
 * internally and returns error states (title: "Error", console.errors populated)
 * rather than throwing. These tests verify that error states are correctly
 * reported and the controller remains functional after errors.
 *
 * Each test launches and stops its own browser instance.
 * Run: npx vitest run tests/core/error-paths.test.ts --config vitest.config.browser.ts
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpCounter = 0;
function makeTmpDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `talox-error-test-${++tmpCounter}-`));
	return dir;
}

/**
 * Create a local HTTP server that never responds — used to simulate network timeouts.
 */
function createHangingServer(port = 0): Promise<{ url: string; close: () => void }> {
	const server = http.createServer((_req, res) => {
		// Intentionally never respond — simulate a hanging connection
		setTimeout(() => {
			try {
				res.end();
			} catch {
				/* already closed */
			}
		}, 300_000); // 5 min safety
	});

	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(port, () => {
			const addr = server.address();
			const actualPort = typeof addr === "object" && addr ? addr.port : port;
			resolve({
				url: `http://localhost:${actualPort}`,
				close: () => new Promise<void>((res) => server.close(() => res())),
			});
		});
	});
}

/** Check if a TaloxPageState represents an error state (never threw). */
function isErrorState(state: { title?: string; console?: { errors?: string[] } }): boolean {
	return state.title === "Error" || (state.console?.errors?.length ?? 0) > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: Network timeout mid-action
// ═══════════════════════════════════════════════════════════════════════════════

describe("error-path: network timeout mid-action", () => {
	let talox: TaloxController;
	let tmpDir: string;
	let hangingServer: { url: string; close: () => void };

	beforeAll(async () => {
		tmpDir = makeTmpDir();
		hangingServer = await createHangingServer();
		talox = new TaloxController(tmpDir, {
			settings: { headed: false, verbosity: 0 },
		});
		await talox.launch("err-timeout", "sandbox", "chromium");
	});

	afterAll(async () => {
		try {
			await talox.stop();
		} catch {
			/* swallow */
		}
		await hangingServer.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("navigate to a URL that never responds returns error state", async () => {
		// TaloxController catches the timeout and returns an error state
		const state = await talox.navigate(hangingServer.url);
		expect(state).toBeDefined();
		expect(isErrorState(state)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: Browser crash recovery (page closed externally)
// ═══════════════════════════════════════════════════════════════════════════════

describe("error-path: browser crash recovery", () => {
	let talox: TaloxController;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = makeTmpDir();
		talox = new TaloxController(tmpDir, {
			settings: { headed: false, verbosity: 0 },
		});
		await talox.launch("err-crash", "sandbox", "chromium");
	});

	afterAll(async () => {
		try {
			await talox.stop();
		} catch {
			/* swallow */
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("actions after page is closed externally return a state (error or auto-recovered), not hang", async () => {
		// First navigate to a real page to confirm it works
		const state = await talox.navigate("about:blank");
		expect(state).toBeDefined();

		// Close the underlying page externally (simulates crash)
		const page = talox._session.getPlaywrightPage();
		if (page && !page.isClosed()) {
			await page.close().catch(() => {});
		}

		// TaloxController either auto-recovers (new page) or returns error state.
		// Either way it must NOT hang — it must return a defined state promptly.
		const clickState = await talox.click("body");
		expect(clickState).toBeDefined();
		expect(clickState).toHaveProperty("url");
		// If it auto-recovered to about:blank, that's fine.
		// If it returned an error state, that's also fine.
		// The key invariant: no hang, state is returned.
	});

	it("stop() should still succeed after page crash", async () => {
		await expect(talox.stop()).resolves.toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: Concurrent session conflicts (same profileId)
// ═══════════════════════════════════════════════════════════════════════════════

describe("error-path: concurrent session conflicts", () => {
	let talox1: TaloxController;
	let talox2: TaloxController;
	let tmpDir1: string;
	let tmpDir2: string;

	beforeAll(async () => {
		tmpDir1 = makeTmpDir();
		tmpDir2 = makeTmpDir();
	});

	afterAll(async () => {
		try {
			await talox1.stop();
		} catch {
			/* swallow */
		}
		try {
			await talox2.stop();
		} catch {
			/* swallow */
		}
		fs.rmSync(tmpDir1, { recursive: true, force: true });
		fs.rmSync(tmpDir2, { recursive: true, force: true });
	});

	it("launching two controllers with same profileId from same baseDir should handle gracefully", async () => {
		// Both use the same tmpDir so the profile directory overlaps
		talox1 = new TaloxController(tmpDir1, {
			settings: { headed: false, verbosity: 0 },
		});
		talox2 = new TaloxController(tmpDir1, {
			settings: { headed: false, verbosity: 0 },
		});

		await talox1.launch("conflict-profile", "sandbox", "chromium");

		// Talox owns persistent profiles exclusively within the process. A duplicate
		// owner must fail before browser startup rather than waiting on Chrome locks.
		await expect(talox2.launch("conflict-profile", "sandbox", "chromium")).rejects.toThrow("PROFILE_IN_USE");

		// talox1 should still be functional
		const state = await talox1.navigate("about:blank");
		expect(state).toBeDefined();
		expect(state.url).toBe("about:blank");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: Invalid selector handling
// TaloxController catches selector errors and returns error states.
// ═══════════════════════════════════════════════════════════════════════════════

describe("error-path: invalid selector handling", () => {
	let talox: TaloxController;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = makeTmpDir();
		talox = new TaloxController(tmpDir, {
			settings: { headed: false, verbosity: 0 },
		});
		await talox.launch("err-selector", "sandbox", "chromium");
		await talox.navigate("about:blank");
	});

	afterAll(async () => {
		try {
			await talox.stop();
		} catch {
			/* swallow */
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const malformedSelectors = ["[[[invalid", ">>>><<<<", "#", " ", "!@#$%^&*()"];

	for (const selector of malformedSelectors) {
		it(`click(${JSON.stringify(selector)}) returns error state with console errors`, async () => {
			const state = await talox.click(selector);
			expect(state).toBeDefined();
			expect(isErrorState(state)).toBe(true);
		});
	}

	for (const selector of malformedSelectors) {
		it(`type(${JSON.stringify(selector)}, "hello") returns error state with console errors`, async () => {
			const state = await talox.type(selector, "hello");
			expect(state).toBeDefined();
			expect(isErrorState(state)).toBe(true);
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5: Navigate to invalid URL
// TaloxController catches navigation errors and returns error states.
// ═══════════════════════════════════════════════════════════════════════════════

describe("error-path: navigate to invalid URL", () => {
	let talox: TaloxController;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = makeTmpDir();
		talox = new TaloxController(tmpDir, {
			settings: { headed: false, verbosity: 0 },
		});
		await talox.launch("err-url", "sandbox", "chromium");
	});

	afterAll(async () => {
		try {
			await talox.stop();
		} catch {
			/* swallow */
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const invalidUrls = [
		"not-a-url",
		"ftp:///invalid",
		"http://[::1:bad-ipv6",
		"://missing-scheme",
		"http://localhost:99999", // invalid port
	];

	for (const url of invalidUrls) {
		it(`navigate(${JSON.stringify(url)}) returns error state`, async () => {
			const state = await talox.navigate(url);
			expect(state).toBeDefined();
			expect(isErrorState(state)).toBe(true);
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 6: getState after page navigated away
// ═══════════════════════════════════════════════════════════════════════════════

describe("error-path: getState on page that navigated away", () => {
	let talox: TaloxController;
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = makeTmpDir();
		talox = new TaloxController(tmpDir, {
			settings: { headed: false, verbosity: 0 },
		});
		await talox.launch("err-nav-away", "sandbox", "chromium");
	});

	afterAll(async () => {
		try {
			await talox.stop();
		} catch {
			/* swallow */
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("getState after external navigation should still return a valid state", async () => {
		// Navigate to about:blank first
		const state1 = await talox.navigate("about:blank");
		expect(state1).toBeDefined();

		// Use evaluate to navigate the page away externally
		await talox.evaluate("window.location.href = 'about:srcdoc'").catch(() => {});

		// getState should still work (it collects from the current page state)
		const state2 = await talox.getState();
		expect(state2).toBeDefined();
		expect(state2).toHaveProperty("url");
		expect(state2).toHaveProperty("nodes");
	});
});
