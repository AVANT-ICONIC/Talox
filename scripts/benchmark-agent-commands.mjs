#!/usr/bin/env node
// Measures what `talox text` pays per call on each engine: cold start (process
// launch until a page can be opened), page load (navigation until load) and
// peak resident memory of every browser process this script starts.
// Usage: npm run build && node scripts/benchmark-agent-commands.mjs [--runs 5] [--url <extra-url>]... [--output file.json]
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defaultLightpandaPath, launchBundledChromium, READABLE_TEXT_EXPRESSION } from "../dist/cli/agent-browser.js";
import { LightpandaEngine } from "../dist/core/browser/LightpandaEngine.js";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1] || 5) || 5;
const output = args.includes("--output") ? args[args.indexOf("--output") + 1] : undefined;
const extraUrls = args.flatMap((arg, i) => (arg === "--url" ? [args[i + 1]] : []));

async function descendantsRss() {
	const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,rss="]);
	const rows = stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
	const children = new Map();
	for (const [pid, ppid, rss] of rows) children.set(ppid, [...(children.get(ppid) ?? []), [pid, rss]]);
	let total = 0;
	const stack = [process.pid];
	while (stack.length) {
		for (const [pid, rss] of children.get(stack.pop()) ?? []) {
			total += rss * 1024;
			stack.push(pid);
		}
	}
	return total;
}

async function peakRss(work) {
	let peak = 0;
	let sampling = true;
	const sampler = (async () => {
		while (sampling) {
			peak = Math.max(peak, await descendantsRss().catch(() => 0));
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	})();
	try {
		return { ...(await work()), peakRssBytes: peak };
	} finally {
		sampling = false;
		await sampler;
	}
}

async function chromiumOnce(url) {
	return peakRss(async () => {
		const start = performance.now();
		const { browser, dispose } = await launchBundledChromium(60_000);
		const page = await (await browser.newContext()).newPage();
		const ready = performance.now();
		await page.goto(url, { waitUntil: "load", timeout: 60_000 });
		const loaded = performance.now();
		const value = await page.evaluate(READABLE_TEXT_EXPRESSION);
		const extracted = performance.now();
		await dispose();
		const done = performance.now();
		return {
			coldStartMs: ready - start,
			pageLoadMs: loaded - ready,
			extractMs: extracted - loaded,
			closeMs: done - extracted,
			totalMs: done - start,
			chars: value.text.length,
		};
	});
}

// What an agent pays: a fresh `talox text` process, start to exit.
async function cliOnce(engine, url) {
	return peakRss(async () => {
		const start = performance.now();
		const { stdout } = await run(process.execPath, [path.join(root, "dist/cli/entry.js"), "text", url, "--engine", engine, "--json"], {
			maxBuffer: 64 * 1024 * 1024,
			timeout: 120_000,
		});
		const result = JSON.parse(stdout);
		if (result.engine !== engine) throw new Error(`asked for ${engine}, read with ${result.engine}`);
		return { cliMs: performance.now() - start, chars: result.text.length };
	});
}

async function lightpandaOnce(url) {
	return peakRss(async () => {
		const timings = {};
		const engine = new LightpandaEngine({
			executablePath: defaultLightpandaPath(),
			onTiming: ({ phase, durationMs }) => {
				timings[phase] = durationMs;
			},
		});
		const start = performance.now();
		const controller = new AbortController();
		const value = await engine.execute(
			{ url, operation: "evaluate", expression: READABLE_TEXT_EXPRESSION, readOnly: true, trustedContent: true, timeoutMs: 60_000 },
			controller.signal,
		);
		const extracted = performance.now();
		await engine.close();
		const done = performance.now();
		return {
			coldStartMs: timings.startup,
			pageLoadMs: timings.navigation,
			extractMs: timings.execution,
			closeMs: done - extracted,
			totalMs: done - start,
			chars: value.text.length,
		};
	});
}

const median = (values) => {
	const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
	return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const fixtures = path.join(root, "tests/fixtures/browser-engines");
const server = http.createServer(async (request, response) => {
	const name = path.basename(new URL(request.url, "http://x").pathname);
	try {
		const { readFile } = await import("node:fs/promises");
		response.writeHead(200, { "content-type": "text/html" }).end(await readFile(path.join(fixtures, name)));
	} catch {
		response.writeHead(404).end();
	}
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const pages = [`${base}/static.html`, `${base}/javascript.html`, `${base}/spa.html`, ...extraUrls];

const report = { date: new Date().toISOString(), host: { platform: `${process.platform}-${process.arch}`, cpus: os.cpus().length, loadBefore: os.loadavg() }, runs, pages: [] };
for (const url of pages) {
	const entry = { url: url.replace(base, "<local>"), lightpanda: [], chromium: [] };
	// Interleave engines so a load spike on the shared host hits both.
	for (let i = 0; i < runs; i += 1) {
		for (const [name, once] of [["lightpanda", lightpandaOnce], ["chromium", chromiumOnce]]) {
			let library;
			let cli;
			try {
				library = await once(url);
			} catch (error) {
				library = { error: error instanceof Error ? error.message : String(error) };
			}
			try {
				cli = await cliOnce(name, url);
			} catch (error) {
				cli = { cliError: error instanceof Error ? error.message : String(error) };
			}
			entry[name].push({ ...library, cliMs: cli.cliMs ?? null, cliPeakRssBytes: cli.peakRssBytes ?? null, ...(cli.cliError ? { cliError: cli.cliError } : {}) });
		}
	}
	entry.median = Object.fromEntries(
		["lightpanda", "chromium"].map((name) => [
			name,
			Object.fromEntries(
				["coldStartMs", "pageLoadMs", "closeMs", "totalMs", "peakRssBytes", "cliMs", "cliPeakRssBytes"].map((key) => [key, median(entry[name].map((r) => r[key]))]),
			),
		]),
	);
	entry.failures = Object.fromEntries(
		["lightpanda", "chromium"].map((name) => [name, entry[name].filter((r) => r.error || r.cliError).length]),
	);
	report.pages.push(entry);
	console.error(`${entry.url}: ${JSON.stringify(entry.median)} failures=${JSON.stringify(entry.failures)}`);
}
report.host.loadAfter = os.loadavg();
server.close();

const mb = (bytes) => (bytes === null ? "n/a" : `${Math.round(bytes / 1048576)} MB`);
const ms = (value) => (value === null ? "n/a" : `${Math.round(value)} ms`);
const lines = [
	`| Page | Engine | Cold start | Page load | Close | Total | Peak RSS | \`talox text\` wall | CLI peak RSS | Failures |`,
	`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
	...report.pages.flatMap((page) =>
		["lightpanda", "chromium"].map(
			(name) =>
				`| ${page.url} | ${name} | ${ms(page.median[name].coldStartMs)} | ${ms(page.median[name].pageLoadMs)} | ${ms(page.median[name].closeMs)} | ${ms(page.median[name].totalMs)} | ${mb(page.median[name].peakRssBytes)} | ${ms(page.median[name].cliMs)} | ${mb(page.median[name].cliPeakRssBytes)} | ${page.failures[name]}/${runs} |`,
		),
	),
];
console.log(lines.join("\n"));
console.log(`\nMedian of ${runs} interleaved runs; load average ${report.host.loadBefore.map((v) => v.toFixed(0)).join("/")} before, ${report.host.loadAfter.map((v) => v.toFixed(0)).join("/")} after, ${report.host.cpus} cores.`);
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
