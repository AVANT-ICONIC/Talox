/**
 * @file controller.e2e.test.ts
 * @description Local E2E tests for TaloxController against a fixture HTTP server.
 *
 * No external network — everything runs against local HTML fixtures served
 * by a tiny Node http server (tests/e2e/helpers.ts).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import { type FixtureServer, startFixtureServer } from "./helpers.js";

// ─── Shared state ──────────────────────────────────────────────────────────

let server: FixtureServer;
let talox: TaloxController;
let tmpDir: string;

// ─── Boot / teardown ──────────────────────────────────────────────────────

beforeAll(async () => {
	server = await startFixtureServer(3210);
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "talox-e2e-"));
	talox = new TaloxController(tmpDir, {
		settings: {
			headed: false,
			verbosity: 0,
			safeMode: true,
		},
	});
	await talox.launch("e2e-test", "sandbox", "chromium");
});

afterAll(async () => {
	try {
		await talox.stop();
	} catch {
		// Swallow — browser may already be closed
	}
	if (server) {
		await server.close().catch(() => {});
	}
	if (tmpDir) {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function fixtureUrl(path_: string): string {
	return `${server.url}/${path_}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("TaloxController E2E — fixture pages", () => {
	// ─── Clicker: click target → score changes ─────────────────────────────

	describe("clicker.html", () => {
		it("should navigate to clicker page and read initial score", async () => {
			const state = await talox.navigate(fixtureUrl("clicker.html"));
			expect(state.title).toContain("Clicker");
			expect(state.console.errors).toHaveLength(0);
		});

		it("should click the target and verify score changes", async () => {
			// Read initial score
			const beforeScore = await talox.evaluate<string>(
				`document.getElementById('score').innerText`,
			);
			expect(beforeScore).toContain("Score: 0");

			// Click the target
			await talox.click("#target");

			// Verify score incremented
			const afterScore = await talox.evaluate<string>(
				`document.getElementById('score').innerText`,
			);
			expect(afterScore).toContain("Score: 1");
		});

		it("should type into name input and verify greeting", async () => {
			await talox.type("#nameInput", "Talox");
			const greeting = await talox.evaluate<string>(
				`document.getElementById('greeting').innerText`,
			);
			expect(greeting).toBe("Hello, Talox!");
		});
	});

	// ─── Form: fill fields, submit, verify ─────────────────────────────────

	describe("form.html", () => {
		it("should fill and submit a form", async () => {
			await talox.navigate(fixtureUrl("form.html"));

			await talox.type("#firstName", "Jane");
			await talox.type("#lastName", "Doe");
			await talox.type("#email", "jane@example.com");

			// Select country
			await talox.evaluate(`
				document.getElementById('country').value = 'uk';
				document.getElementById('country').dispatchEvent(new Event('change'));
			`);

			// Check the agreeTerms checkbox
			await talox.evaluate(`
				document.getElementById('agreeTerms').checked = true;
			`);

			// Select a radio button
			await talox.evaluate(`
				document.querySelector('input[name="plan"][value="pro"]').checked = true;
			`);

			// Click submit
			await talox.click("#submitBtn");

			// Wait briefly for DOM update
			await talox.waitForTimeout(500);

			const result = await talox.evaluate<string>(
				`document.getElementById('result').textContent`,
			);

			expect(result).toContain('"firstName":"Jane"');
			expect(result).toContain('"lastName":"Doe"');
			expect(result).toContain('"email":"jane@example.com"');
			expect(result).toContain('"country":"uk"');
			expect(result).toContain('"agreeTerms":true');
			expect(result).toContain('"plan":"pro"');
		});
	});

	// ─── Table: extractTable ───────────────────────────────────────────────

	describe("table.html", () => {
		it("should extract table data as JSON", async () => {
			await talox.navigate(fixtureUrl("table.html"));

			const rows = await talox.extractTable("#employeeTable");

			// extractTable returns header + data rows (6 total for this table)
			// The first row is the header row (ID/Name/Department/Salary text values)
			expect(rows).toHaveLength(6);
			expect(rows[1]).toEqual({
				ID: "1",
				Name: "Alice Johnson",
				Department: "Engineering",
				Salary: "$120,000",
			});
			// Find Eve Davis in any row (header row may be interleaved)
			const eveRow = rows.find((r) => r.Name === "Eve Davis");
			expect(eveRow).toBeDefined();
		});
	});

	// ─── Buggy page: detect bugs and console errors ────────────────────────

	describe("buggy.html", () => {
		it("should detect console errors from the buggy page", async () => {
			const state = await talox.navigate(fixtureUrl("buggy.html"));

			// The buggy page fires console.error("Initial load error")
			expect(state.console.errors.length).toBeGreaterThanOrEqual(1);
		});

		it("should detect bugs via rules engine", async () => {
			const state = await talox.getState();

			// The page has overlapping buttons and a clipped element
			expect(state.bugs.length).toBeGreaterThanOrEqual(1);
		});
	});

	// ─── Slow page: wait for delayed content ───────────────────────────────

	describe("slow.html", () => {
		it("should wait for delayed content to appear", async () => {
			await talox.navigate(fixtureUrl("slow.html"));

			// Wait for the content to become ready (1.5s delay + margin)
			await talox.waitForSelector("#content[data-loaded='true']", 5000);

			const loadedStatus = await talox.evaluate<string>(
				`document.getElementById('status').textContent`,
			);
			expect(loadedStatus).toBe("Loaded!");

			const contentLoaded = await talox.evaluate<string>(
				`document.getElementById('content').getAttribute('data-loaded')`,
			);
			expect(contentLoaded).toBe("true");
		});
	});

	// ─── Screenshot ────────────────────────────────────────────────────────

	describe("screenshot()", () => {
		it("should capture a screenshot buffer", async () => {
			await talox.navigate(fixtureUrl("clicker.html"));
			const screenshot = await talox.screenshot();

			expect(screenshot).toBeDefined();
			if (typeof screenshot === "string") {
				// path-based — file should exist
				expect(fs.existsSync(screenshot)).toBe(true);
			} else {
				// Buffer-based — should be non-empty PNG
				expect(screenshot.length).toBeGreaterThan(100);
				// PNG magic bytes
				expect(screenshot[0]).toBe(0x89);
				expect(screenshot[1]).toBe(0x50); // 'P'
			}
		});
	});

	// ─── evaluate() ────────────────────────────────────────────────────────

	describe("evaluate()", () => {
		it("should run arbitrary JS and return result", async () => {
			await talox.navigate(fixtureUrl("table.html"));

			const rowCount = await talox.evaluate<number>(
				`document.querySelectorAll('#employeeTable tbody tr').length`,
			);
			expect(rowCount).toBe(5);
		});

		it("should handle object return values", async () => {
			const obj = await talox.evaluate<{ page: string }>(
				`({ page: document.title })`,
			);
			expect(obj.page).toContain("Table");
		});
	});

	// ─── Navigation: multi-page ────────────────────────────────────────────

	describe("navigation", () => {
		it("should navigate between fixture pages", async () => {
			await talox.navigate(fixtureUrl("navigation.html"));

			let pageId = await talox.evaluate<string>(
				`document.getElementById('pageId').textContent`,
			);
			expect(pageId).toBe("Page A");

			// Click link to Page B
			await talox.click("#linkToB");
			await talox.waitForLoadState("domcontentloaded", 5000);

			pageId = await talox.evaluate<string>(
				`document.getElementById('pageId').textContent`,
			);
			expect(pageId).toBe("Page B");

			// Navigate back to Page A
			await talox.click("#linkToA");
			await talox.waitForLoadState("domcontentloaded", 5000);

			pageId = await talox.evaluate<string>(
				`document.getElementById('pageId').textContent`,
			);
			expect(pageId).toBe("Page A");
		});

		it("should navigate to clicker via link", async () => {
			await talox.navigate(fixtureUrl("navigation.html"));
			await talox.click("#linkToClicker");
			await talox.waitForLoadState("domcontentloaded", 5000);

			const title = await talox.evaluate<string>(`document.title`);
			expect(title).toContain("Clicker");
		});
	});
});
