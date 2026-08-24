import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseReplayArgs, shouldUseReplayCommand } from "../../src/cli/replay";
import { loadReplayBundle } from "../../src/core/replay/ReplayLoader";
import { renderReplayHtml } from "../../src/core/replay/ReplayRenderer";
import type { TaloxSessionReport } from "../../src/types/session";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function report(overrides: Partial<TaloxSessionReport> = {}): TaloxSessionReport {
	return {
		id: "replay-test",
		startedAt: "2026-08-24T20:00:00.000Z",
		endedAt: "2026-08-24T20:00:04.000Z",
		durationMs: 4000,
		startUrl: "https://example.com",
		interactions: [
			{
				index: 1,
				type: "click",
				timestamp: "2026-08-24T20:00:01.000Z",
				url: "https://example.com",
				element: {
					tag: "button",
					role: "button",
					text: "Continue",
					selector: "#continue",
					boundingBox: { x: 20, y: 30, width: 100, height: 40 },
				},
				consoleErrors: [],
				networkFailures: [],
				screenshotBefore: "screenshots/interaction-1-before.png",
				screenshotAfter: "screenshots/interaction-1-after.png",
			},
		],
		annotations: [],
		summary: {
			totalInteractions: 1,
			totalAnnotations: 0,
			totalConsoleErrors: 0,
			totalNetworkFailures: 0,
			annotationsByLabel: {},
		},
		...overrides,
	};
}

async function makeSession(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "talox-replay-"));
	tempDirs.push(dir);
	await fs.writeFile(path.join(dir, "report.json"), JSON.stringify(report()), "utf-8");
	return dir;
}

describe("ReplayLoader", () => {
	it("loads a session by directory", async () => {
		const dir = await makeSession();
		const bundle = await loadReplayBundle(dir);
		expect(bundle.sessionDir).toBe(dir);
		expect(bundle.report.id).toBe("replay-test");
	});

	it("loads a session by report.json path", async () => {
		const dir = await makeSession();
		const bundle = await loadReplayBundle(path.join(dir, "report.json"));
		expect(bundle.sessionDir).toBe(dir);
		expect(bundle.report.interactions).toHaveLength(1);
	});

	it("loads optional bugs, failures, diffs and trace artifacts", async () => {
		const dir = await makeSession();
		await fs.writeFile(
			path.join(dir, "bugs.json"),
			JSON.stringify([{ id: "b1", type: "CLIP", severity: "MAJOR", description: "Clipped", interactionIndex: 1 }]),
		);
		await fs.writeFile(
			path.join(dir, "failures.json"),
			JSON.stringify([{ type: "network", message: "Bad gateway", interactionIndex: 1 }]),
		);
		await fs.writeFile(
			path.join(dir, "diffs.json"),
			JSON.stringify([{ interactionIndex: 1, url: "https://example.com", urlChanged: false }]),
		);
		await fs.writeFile(
			path.join(dir, "trace.json"),
			JSON.stringify([{ frameIndex: 0, timestamp: "2026-08-24T20:00:01.000Z", relativeTimeMs: 1000, type: "CLICK", action: "Click Action", details: {} }]),
		);

		const bundle = await loadReplayBundle(dir);
		expect(bundle.extras.bugs).toHaveLength(1);
		expect(bundle.extras.failures).toHaveLength(1);
		expect(bundle.extras.diffs).toHaveLength(1);
		expect(bundle.extras.trace).toHaveLength(1);
	});

	it("rejects malformed reports", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "talox-replay-bad-"));
		tempDirs.push(dir);
		await fs.writeFile(path.join(dir, "report.json"), JSON.stringify({ id: "not-enough" }));
		await expect(loadReplayBundle(dir)).rejects.toThrow("Invalid Talox session report");
	});
});

describe("ReplayRenderer", () => {
	it("renders an offline player with timeline and transport controls", () => {
		const html = renderReplayHtml({ sessionDir: "/tmp/session", report: report(), extras: {} });
		expect(html).toContain("TALOX");
		expect(html).toContain("REPLAY");
		expect(html).toContain('id="timeline"');
		expect(html).toContain('id="playBtn"');
		expect(html).toContain('id="beforeBtn"');
		expect(html).toContain('id="targetBox"');
	});

	it("embeds persisted screenshot paths for offline playback", () => {
		const html = renderReplayHtml({ sessionDir: "/tmp/session", report: report(), extras: {} });
		expect(html).toContain("screenshots/interaction-1-before.png");
		expect(html).toContain("screenshots/interaction-1-after.png");
	});

	it("neutralizes closing script tags inside session data", () => {
		const hostile = report({ id: "</script><script>alert(1)</script>" });
		const html = renderReplayHtml({ sessionDir: "/tmp/session", report: hostile, extras: {} });
		expect(html).not.toContain("</script><script>alert(1)</script>");
		expect(html).toContain("\\u003c/script>");
	});
});

describe("Replay CLI", () => {
	it("routes replay as a dedicated top-level command", () => {
		expect(shouldUseReplayCommand(["replay", "./session"])).toBe(true);
		expect(shouldUseReplayCommand(["observe"])).toBe(false);
	});

	it("parses input, output and open options", () => {
		expect(parseReplayArgs(["./session", "--output", "./out/replay.html", "--open"])).toEqual({
			inputPath: "./session",
			outputPath: "./out/replay.html",
			open: true,
			help: false,
		});
	});

	it("rejects unknown options and duplicate positional paths", () => {
		expect(() => parseReplayArgs(["--wat"])).toThrow("Unknown replay option");
		expect(() => parseReplayArgs(["one", "two"])).toThrow("Unexpected replay argument");
	});
});
