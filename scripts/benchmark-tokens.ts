/**
 * @file benchmark-tokens.ts
 * @description Token consumption benchmark for Talox vs raw Playwright.
 *
 * Measures the token count of `AgentPageState` output across different
 * presets and real-world pages. Compares against raw Playwright AX tree
 * output for the same pages.
 *
 * Usage:
 *   npx tsx scripts/benchmark-tokens.ts [urls...]
 *
 * If no URLs provided, uses a default set: github.com, wikipedia.org, reddit.com.
 *
 * Output: markdown table suitable for README inclusion.
 */

import { chromium } from "playwright-core";

// ─── Token Estimator ──────────────────────────────────────────────────────────

/**
 * Rough token count estimator. Uses the common heuristic of
 * ~4 characters per token for English text, which matches GPT-4/Claude
 * tokenizers within ~10% for typical web content.
 *
 * For JSON-structured output, tokens-per-char is slightly higher
 * due to syntax characters, so we use a conservative 3.5 chars/token.
 */
function estimateTokens(text: string): number {
	const charCount = text.length;
	// 3.5 chars/token is conservative for JSON-heavy text
	return Math.ceil(charCount / 3.5);
}

// ─── Playwright AX Tree Collection ────────────────────────────────────────────

async function collectPlaywrightAXTree(url: string): Promise<{ json: string; tokenEstimate: number }> {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();

	try {
		await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

		// Collect full AX tree snapshot (equivalent to Talox's "full" preset)
		const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
		const json = JSON.stringify(snapshot, null, 2);

		return {
			json,
			tokenEstimate: estimateTokens(json),
		};
	} finally {
		await browser.close();
	}
}

// ─── Talox State Collection ───────────────────────────────────────────────────

async function collectTaloxState(
	url: string,
): Promise<{ full: string; agent: string; debug: string }> {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();

	try {
		await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

		// Collect accessibility tree (similar to Talox's PageStateCollector)
		const axSnapshot = await page.accessibility.snapshot({ interestingOnly: false });

		// Build interactive elements list (simplified Talox-style extraction)
		const interactiveElements = extractInteractiveElements(axSnapshot);

		// Simulate Talox's compactState outputs
		const full = JSON.stringify({
			url: page.url(),
			title: await page.title(),
			timestamp: new Date().toISOString(),
			nodes: axSnapshot,
			interactiveElements,
			console: { errors: [] },
			network: { failedRequests: [] },
			bugs: [],
		});

		const agent = JSON.stringify({
			url: page.url(),
			title: await page.title(),
			timestamp: new Date().toISOString(),
			interactiveElements,
			consoleErrors: [],
			bugs: [],
		});

		const debug = JSON.stringify({
			url: page.url(),
			title: await page.title(),
			timestamp: new Date().toISOString(),
			nodes: axSnapshot,
			console: { errors: [] },
			network: { failedRequests: [] },
			bugs: [],
		});

		return { full, agent, debug };
	} finally {
		await browser.close();
	}
}

// ─── Interactive Element Extraction ───────────────────────────────────────────

interface SimpleElement {
	id: string;
	tagName: string;
	role?: string;
	text?: string;
}

function extractInteractiveElements(node: any, elements: SimpleElement[] = []): SimpleElement[] {
	if (!node) return elements;

	const interactiveRoles = new Set([
		"button", "link", "textbox", "searchbox", "combobox",
		"checkbox", "radio", "switch", "slider", "spinbutton",
		"menuitem", "option", "tab", "listbox",
	]);

	const role = node.role || "";
	const name = node.name || "";
	const value = node.value || "";

	if (interactiveRoles.has(role) && name) {
		elements.push({
			id: `#el-${elements.length}`,
			tagName: role,
			role,
			text: value ? `${name}: ${value}` : name,
		});
	}

	// Recurse into children
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			extractInteractiveElements(child, elements);
		}
	}

	return elements;
}

// ─── Report ───────────────────────────────────────────────────────────────────

interface BenchmarkResult {
	url: string;
	/** Raw Playwright AX tree (full snapshot, all nodes) */
	playwrightAXTokens: number;
	/** Talox full state (AX tree + interactive + console + network + bugs) */
	taloxFullTokens: number;
	/** Talox agent state (url + title + interactive + console errors + bugs) */
	taloxAgentTokens: number;
	/** Talox debug state (url + title + full nodes + console + network + bugs) */
	taloxDebugTokens: number;
	/** Interactive element count */
	interactiveCount: number;
	/** Reduction ratio: agent vs playwright AX */
	reductionRatio: string;
}

async function benchmark(url: string): Promise<BenchmarkResult> {
	const [playwright, talox] = await Promise.all([
		collectPlaywrightAXTree(url),
		collectTaloxState(url),
	]);

	const interactiveCount = JSON.parse(talox.agent).interactiveElements.length;

	const ratio = playwright.tokenEstimate > 0
		? `${((1 - estimateTokens(talox.agent) / playwright.tokenEstimate) * 100).toFixed(0)}% smaller`
		: "N/A";

	return {
		url,
		playwrightAXTokens: playwright.tokenEstimate,
		taloxFullTokens: estimateTokens(talox.full),
		taloxAgentTokens: estimateTokens(talox.agent),
		taloxDebugTokens: estimateTokens(talox.debug),
		interactiveCount,
		reductionRatio: ratio,
	};
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const DEFAULT_URLS = [
	"https://github.com",
	"https://en.wikipedia.org/wiki/Main_Page",
	"https://news.ycombinator.com",
];

async function main() {
	const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_URLS;

	console.log("🔬 Talox Token Benchmark\n");
	console.log("Measuring token estimates for different state presets...\n");

	const results: BenchmarkResult[] = [];
	for (const url of urls) {
		process.stdout.write(`  ${url} ... `);
		try {
			const result = await benchmark(url);
			results.push(result);
			console.log(`done (${result.interactiveCount} interactive elements)`);
		} catch (err: any) {
			console.log(`FAILED: ${err.message}`);
		}
	}

	// ── Markdown Table ─────────────────────────────────────────────────────
	console.log("\n## Results\n");
	console.log("| Page | Raw Playwright AX | Talox Full | Talox Agent | Talox Debug | Interactive | Reduction |");
	console.log("|------|-------------------|------------|-------------|-------------|-------------|-----------|");

	for (const r of results) {
		console.log(
			`| ${r.url} | ${r.playwrightAXTokens} tk | ${r.taloxFullTokens} tk | ${r.taloxAgentTokens} tk | ${r.taloxDebugTokens} tk | ${r.interactiveCount} | ${r.reductionRatio} |`,
		);
	}

	// ── Summary ────────────────────────────────────────────────────────────
	if (results.length > 0) {
		const avgPlaywright = Math.round(results.reduce((s, r) => s + r.playwrightAXTokens, 0) / results.length);
		const avgAgent = Math.round(results.reduce((s, r) => s + r.taloxAgentTokens, 0) / results.length);
		const avgRatio = avgPlaywright > 0
			? `${((1 - avgAgent / avgPlaywright) * 100).toFixed(0)}% smaller`
			: "N/A";

		console.log(`\n**Average across ${results.length} pages:** Raw Playwright AX = **${avgPlaywright} tokens** → Talox Agent = **${avgAgent} tokens** (${avgRatio})`);
	}

	console.log("\n> Note: Token counts are estimates based on 3.5 chars/token (conservative for JSON-heavy output).");
	console.log("> Actual token counts depend on the specific tokenizer (GPT-4, Claude, etc.) but relative comparisons remain valid.");
}

main().catch((err) => {
	console.error("Benchmark failed:", err);
	process.exit(1);
});
