/**
 * @file 00-detection-suite.spec.ts
 * @description Detection score tracking against major bot/fingerprint test suites.
 *
 * Runs Talox against real detection sites and captures quantitative scores.
 * These tests document current detection status — they PASS as long as scores
 * are captured, not based on achieving a specific score.
 *
 * Suites tested:
 * - Sannysoft Bot Detection (bot.sannysoft.com) — current table pass/fail checks
 * - CreepJS (abrahamjuliot.github.io/creepjs) — trust/lie scores
 * - BrowserLeaks (browserleaks.com) — loads without block
 *
 * Mode: smart (headed) — detection tests require a real browser window.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { TaloxController } from "../../src/index.js";

let talox: TaloxController;
let profileDir: string;

interface DetectionResults {
	timestamp: string;
	sannysoft: SannysoftResult;
	creepjs: CreepJSResult;
	browserleaks: { loaded: boolean; title: string };
}

interface SannysoftResult {
	total: number;
	passed: number;
	failed: number;
	failedChecks: string[];
}

interface CreepJSResult {
	trustScore: string;
	visits: number;
	bot: boolean;
	loaded: boolean;
}

const RESULTS_PATH = path.join(process.cwd(), "tests", "real", "detection-results.json");

function loadPreviousResults(): DetectionResults | null {
	try {
		if (fs.existsSync(RESULTS_PATH)) {
			return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf-8"));
		}
	} catch {
		// Ignored: corrupted or missing file
	}
	return null;
}

function saveResults(results: DetectionResults): void {
	fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
}

test.describe("Detection Score Suite", () => {
	test.setTimeout(300_000);

	test.beforeAll(async () => {
		profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "talox-detect-"));
		talox = new TaloxController(profileDir, { mode: "smart" });
		await talox.launch("detection-suite", "sandbox", "chromium");
	});

	test.afterAll(async () => {
		await talox.stop();
		fs.rmSync(profileDir, { recursive: true, force: true });
	});

	// ─── Sannysoft ────────────────────────────────────────────────────────

	test("Sannysoft Bot Detection — captures current check results", async () => {
		await talox.navigate("https://bot.sannysoft.com/");
		await talox.evaluate(`new Promise(r => setTimeout(r, 3000))`);

		const result = await talox.evaluate<SannysoftResult>(`
			(() => {
				const rows = document.querySelectorAll('table tr');
				let passed = 0;
				let failed = 0;
				let total = 0;
				const failedChecks = [];

				rows.forEach(row => {
					const cells = row.querySelectorAll('td');
					if (cells.length < 2) return;

					const label = cells[0]?.textContent?.trim() || '';
					if (!label) return;

					const value = cells[1]?.textContent?.trim() || '';
					const className = String(cells[1]?.className || '').toLowerCase();
					const isFailed = className.includes('failed');

					total++;
					if (isFailed) {
						failed++;
						failedChecks.push(label + ': ' + value);
					} else {
						passed++;
					}
				});

				return { total, passed, failed, failedChecks };
			})()
		`);

		console.log(`[Sannysoft] ${result.passed}/${result.total} passed`);
		if (result.failedChecks.length > 0) {
			console.log(`[Sannysoft] Failed checks: ${result.failedChecks.join(", ")}`);
		}

		// Document current score — do NOT fail on low scores. Only a parser/page
		// failure (zero captured rows) is an error; actual failed checks are evidence.
		const previous = loadPreviousResults();
		if (previous?.sannysoft) {
			const prevScore = previous.sannysoft.passed;
			if (result.passed < prevScore) {
				console.warn(
					`[Sannysoft] REGRESSION: ${result.passed} < previous ${prevScore}. ` +
						`New failures: ${result.failedChecks.join(", ")}`,
				);
			} else if (result.passed > prevScore) {
				console.log(`[Sannysoft] IMPROVEMENT: ${result.passed} > previous ${prevScore}`);
			}
		}

		// Persist even a zero-row parser result before failing. That keeps the final
		// regression-summary test from cascading into a second unrelated failure.
		const current = previous || ({} as DetectionResults);
		current.timestamp = new Date().toISOString();
		current.sannysoft = result;
		saveResults(current as DetectionResults);

		// We must detect at least some checks — the page/parser must have worked.
		expect(result.total).toBeGreaterThan(0);
	});

	// ─── CreepJS ──────────────────────────────────────────────────────────

	test("CreepJS — captures trust score and lie detection", async () => {
		await talox.navigate("https://abrahamjuliot.github.io/creepjs/");
		// CreepJS needs time to run all fingerprint tests
		await talox.evaluate(`new Promise(r => setTimeout(r, 15000))`);

		const result = await talox.evaluate<CreepJSResult>(`
			(() => {
				const text = document.body.innerText || '';

				// Extract trust score — CreepJS shows "Trust: X%" in various formats
				let trustScore = 'unknown';
				const trustMatch = text.match(/trust[^\\d]*?(\\d+\\.?\\d*)\\s*%/i);
				if (trustMatch) trustScore = trustMatch[1] + '%';

				// Check for bot detection keywords
				const botDetected = /bot|automated|headless|puppeteer|playwright|selenium|webdriver/i.test(text);

				// Extract visit count if visible
				let visits = 0;
				const visitMatch = text.match(/(\\d+)\\s*visit/i);
				if (visitMatch) visits = parseInt(visitMatch[1], 10);

				return {
					trustScore,
					visits,
					bot: botDetected,
					loaded: text.length > 100,
				};
			})()
		`);

		console.log(`[CreepJS] Trust: ${result.trustScore}, Bot detected: ${result.bot}, Visits: ${result.visits}`);
		console.log(`[CreepJS] Page loaded: ${result.loaded}`);

		// Page must have loaded and rendered content
		expect(result.loaded).toBe(true);

		// Save for tracking
		const current = loadPreviousResults() || ({} as DetectionResults);
		current.timestamp = new Date().toISOString();
		current.creepjs = result;
		saveResults(current as DetectionResults);
	});

	// ─── BrowserLeaks ─────────────────────────────────────────────────────

	test("BrowserLeaks — loads without block", async () => {
		await talox.navigate("https://browserleaks.com/");
		await talox.evaluate(`new Promise(r => setTimeout(r, 3000))`);

		const title = await talox.evaluate<string>("document.title");
		const loaded = title.length > 0 && !title.toLowerCase().includes("blocked");

		console.log(`[BrowserLeaks] Title: "${title}", Loaded: ${loaded}`);

		expect(loaded).toBe(true);

		const current = loadPreviousResults() || ({} as DetectionResults);
		current.timestamp = new Date().toISOString();
		current.browserleaks = { loaded, title };
		saveResults(current as DetectionResults);
	});

	// ─── Regression Guard ─────────────────────────────────────────────────

	test("Detection results are saved for regression tracking", async () => {
		const results = loadPreviousResults();
		expect(results).not.toBeNull();
		expect(results!.timestamp).toBeTruthy();
		expect(results!.sannysoft).toBeDefined();
		expect(results!.creepjs).toBeDefined();
		expect(results!.browserleaks).toBeDefined();

		console.log("\n═══ Detection Score Summary ═══");
		console.log(`  Timestamp: ${results!.timestamp}`);
		console.log(`  Sannysoft: ${results!.sannysoft.passed}/${results!.sannysoft.total}`);
		console.log(`  CreepJS Trust: ${results!.creepjs.trustScore}`);
		console.log(`  CreepJS Bot: ${results!.creepjs.bot}`);
		console.log(`  BrowserLeaks: ${results!.browserleaks.loaded ? "✅" : "❌"}`);
		console.log("═══════════════════════════════\n");
	});
});
