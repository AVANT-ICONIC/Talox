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
 * - CreepJS (abrahamjuliot.github.io/creepjs) — headless/stealth/lie metrics
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
	unclassifiedChecks: string[];
}

interface CreepJSResult {
	likeHeadlessPct: number | null;
	headlessPct: number | null;
	stealthPct: number | null;
	totalLies: number | null;
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
				const tables = document.querySelectorAll('table');
				let passed = 0;
				let failed = 0;
				let total = 0;
				const failedChecks = [];
				const unclassifiedChecks = [];

				const colorStatus = (cell) => {
					const color = getComputedStyle(cell).backgroundColor || '';
					const match = color.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
					if (!match) return 'unknown';
					const red = Number(match[1]);
					const green = Number(match[2]);
					const blue = Number(match[3]);
					if (green >= red + 20 && green >= blue + 20) return 'passed';
					if (red >= green + 20 && red >= blue + 20) return 'failed';
					return 'unknown';
				};

				const classify = (cell, value) => {
					const className = String(cell.className || '').toLowerCase();
					const normalizedValue = value.toLowerCase();
					if (
						className.includes('failed') ||
						normalizedValue === 'failed' ||
						normalizedValue.includes('(failed)')
					) return 'failed';
					if (
						className.includes('passed') ||
						normalizedValue === 'passed' ||
						normalizedValue.includes('(passed)')
					) return 'passed';
					return colorStatus(cell);
				};

				tables.forEach(table => {
					const rows = [];
					table.querySelectorAll('tr').forEach(row => {
						const cells = row.querySelectorAll('td');
						if (cells.length < 2) return;
						const label = cells[0]?.textContent?.trim() || '';
						if (!label) return;
						const cell = cells[1];
						const value = cell?.textContent?.trim() || '';
						rows.push({ label, value, status: classify(cell, value) });
					});

					// Sannysoft also contains raw fingerprint/detail tables that are not
					// pass/fail tests. A scored table must expose at least one explicit
					// pass/fail signal via class, result text, or its computed green/red cell.
					if (!rows.some(row => row.status !== 'unknown')) return;

					rows.forEach(({ label, value, status }) => {
						if (status === 'unknown') {
							unclassifiedChecks.push(label + ': ' + value);
							return;
						}
						total++;
						if (status === 'failed') {
							failed++;
							failedChecks.push(label + ': ' + value);
						} else {
							passed++;
						}
					});
				});

				return { total, passed, failed, failedChecks, unclassifiedChecks };
			})()
		`);

		console.log(`[Sannysoft] ${result.passed}/${result.total} passed`);
		if (result.failedChecks.length > 0) {
			console.log(`[Sannysoft] Failed checks: ${result.failedChecks.join(", ")}`);
		}
		if (result.unclassifiedChecks.length > 0) {
			console.warn(`[Sannysoft] Unclassified checks: ${result.unclassifiedChecks.join(", ")}`);
		}

		// Document current score — do NOT fail on low scores. Only parser/page
		// failures are errors; actual failed checks are compatibility evidence.
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

		// Persist even a parser failure before asserting. That keeps the final
		// regression-summary test from cascading into a duplicate missing-field failure.
		const current = previous || ({} as DetectionResults);
		current.timestamp = new Date().toISOString();
		current.sannysoft = result;
		saveResults(current as DetectionResults);

		// A valid measurement needs at least one classified row and no partially
		// rendered rows inside tables that Sannysoft has identified as scored.
		expect(result.total).toBeGreaterThan(0);
		expect(result.unclassifiedChecks).toHaveLength(0);
	});

	// ─── CreepJS ──────────────────────────────────────────────────────────

	test("CreepJS — captures current headless, stealth, and lie metrics", async () => {
		await talox.navigate("https://abrahamjuliot.github.io/creepjs/");

		// Prefer CreepJS's first-party fingerprint object. Poll briefly because the
		// full fingerprint is assembled asynchronously after the page becomes usable.
		await talox.evaluate(`
			new Promise((resolve) => {
				const deadline = Date.now() + 20_000;
				const check = () => {
					if (window.Fingerprint?.headless) return resolve(true);
					if (Date.now() >= deadline) return resolve(false);
					setTimeout(check, 250);
				};
				check();
			})
		`);

		const result = await talox.evaluate<CreepJSResult>(`
			(() => {
				const text = document.body.innerText || '';
				const fingerprint = window.Fingerprint || {};
				const headless = fingerprint.headless || {};
				const lies = fingerprint.lies || {};

				const numeric = (value) => (
					typeof value === 'number' && Number.isFinite(value) ? value : null
				);
				const textMetric = (pattern) => {
					const match = text.match(pattern);
					return match ? Number(match[1]) : null;
				};

				const likeHeadlessPct = numeric(headless.likeHeadlessRating) ??
					textMetric(/(?:^|\\n)\\s*(\\d+(?:\\.\\d+)?)%\\s*like headless\\s*:/im);
				const headlessPct = numeric(headless.headlessRating) ??
					textMetric(/(?:^|\\n)\\s*(\\d+(?:\\.\\d+)?)%\\s*headless\\s*:/im);
				const stealthPct = numeric(headless.stealthRating) ??
					textMetric(/(?:^|\\n)\\s*(\\d+(?:\\.\\d+)?)%\\s*stealth\\s*:/im);
				const totalLies = numeric(lies.totalLies) ?? (() => {
					const match = text.match(/lies\\s*\\((\\d+)\\)/i);
					return match ? Number(match[1]) : null;
				})();

				return {
					likeHeadlessPct,
					headlessPct,
					stealthPct,
					totalLies,
					loaded: text.length > 100,
				};
			})()
		`);

		console.log(
			`[CreepJS] like-headless=${result.likeHeadlessPct}% ` +
				`headless=${result.headlessPct}% stealth=${result.stealthPct}% lies=${result.totalLies}`,
		);
		console.log(`[CreepJS] Page loaded: ${result.loaded}`);

		// Current CreepJS publishes these values in window.Fingerprint and renders
		// the same percentages in the Headless panel. Null means our measurement
		// contract is stale or the page never completed, not that the browser scored 0.
		expect(result.loaded).toBe(true);
		expect(result.likeHeadlessPct).not.toBeNull();
		expect(result.headlessPct).not.toBeNull();
		expect(result.stealthPct).not.toBeNull();
		expect(result.totalLies).not.toBeNull();

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
		console.log(
			`  CreepJS: ${results!.creepjs.likeHeadlessPct}% like-headless · ` +
				`${results!.creepjs.headlessPct}% headless · ${results!.creepjs.stealthPct}% stealth · ` +
				`${results!.creepjs.totalLies} lies`,
		);
		console.log(`  BrowserLeaks: ${results!.browserleaks.loaded ? "✅" : "❌"}`);
		console.log("═══════════════════════════════\n");
	});
});
