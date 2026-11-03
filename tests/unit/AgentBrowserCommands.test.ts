import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import {
	AgentBrowserUsageError,
	assertBundledChromium,
	bundledChromiumLaunchOptions,
	defaultLightpandaPath,
	normalizeText,
	parseAgentBrowserArgs,
	readText,
	resolveTarget,
	selectTextEngine,
	shouldUseAgentBrowserCommand,
} from "../../src/cli/agent-browser.js";
import { BrowserEngineError } from "../../src/core/browser/types.js";

const page = { url: "https://example.com/", title: "Example", text: "  Hello \n\n\n\n world  " };

describe("agent browser argument parsing", () => {
	it("claims exactly the pdf, shot and text commands", () => {
		expect(["pdf", "shot", "text"].every((command) => shouldUseAgentBrowserCommand([command]))).toBe(true);
		expect(shouldUseAgentBrowserCommand(["screenshot"])).toBe(false);
		expect(shouldUseAgentBrowserCommand([])).toBe(false);
	});

	it("reads a pdf paper size case-insensitively and leaves it unset by default", () => {
		expect(parseAgentBrowserArgs(["pdf", "a.html", "a.pdf", "--size", "a4"]).pdfFormat).toBe("A4");
		expect(parseAgentBrowserArgs(["pdf", "a.html", "a.pdf"]).pdfFormat).toBeUndefined();
		expect(() => parseAgentBrowserArgs(["pdf", "a.html", "a.pdf", "--size", "B5"])).toThrow(AgentBrowserUsageError);
	});

	it("reads a shot viewport as WxH and refuses anything else", () => {
		const options = parseAgentBrowserArgs(["shot", "a.html", "a.png", "--size", "1440x900", "--scale", "2", "--full"]);
		expect(options).toMatchObject({
			viewport: { width: 1440, height: 900 },
			scale: 2,
			fullPage: true,
			output: "a.png",
		});
		for (const size of ["1440", "0x10", "10x99999", "axb"])
			expect(() => parseAgentBrowserArgs(["shot", "a.html", "a.png", "--size", size])).toThrow(AgentBrowserUsageError);
	});

	it("requires the exact positional arguments of each command", () => {
		expect(() => parseAgentBrowserArgs(["pdf", "a.html"])).toThrow(/needs <file-or-url> and <output>/);
		expect(() => parseAgentBrowserArgs(["text", "a", "b"])).toThrow(/exactly one/);
		expect(() => parseAgentBrowserArgs(["text", "a", "--bogus"])).toThrow(/Unknown option/);
		expect(() => parseAgentBrowserArgs(["text", "a", "--size", "A4"])).toThrow(/pdf and shot only/);
		expect(parseAgentBrowserArgs(["text", "--help"]).help).toBe(true);
	});

	it("defaults text to the auto engine and accepts only known engines", () => {
		expect(parseAgentBrowserArgs(["text", "https://a.test"]).engine).toBe("auto");
		expect(parseAgentBrowserArgs(["text", "https://a.test", "--engine", "chromium"]).engine).toBe("chromium");
		expect(() => parseAgentBrowserArgs(["text", "https://a.test", "--engine", "chrome"])).toThrow(
			AgentBrowserUsageError,
		);
	});
});

describe("agent browser targets", () => {
	it("keeps URLs and turns an existing local file into a file URL", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "talox-target-"));
		const file = path.join(dir, "page.html");
		await writeFile(file, "<p>x</p>");
		expect(await resolveTarget("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
		expect(await resolveTarget("page.html", dir)).toBe(pathToFileURL(file).href);
	});

	it("refuses a missing file and an unsupported scheme instead of guessing", async () => {
		await expect(resolveTarget("missing.html", os.tmpdir())).rejects.toThrow(/No such file/);
		await expect(resolveTarget("javascript:alert(1)")).rejects.toThrow(/Unsupported URL scheme/);
	});

	it("finds Lightpanda in the shared per-user cache unless the environment names one", () => {
		expect(defaultLightpandaPath({}, "/home/a")).toBe("/home/a/.cache/talox/lightpanda/1.0.0/lightpanda");
		expect(defaultLightpandaPath({ TALOX_LIGHTPANDA_PATH: "/opt/lp" }, "/home/a")).toBe("/opt/lp");
	});
});

describe("text engine selection", () => {
	const select = (url: string, engine: "auto" | "lightpanda" | "chromium", lightpandaInstalled = true) =>
		selectTextEngine({ url, engine, lightpandaInstalled });

	it("reads HTTP(S) through Lightpanda automatically when it is installed", () => {
		expect(select("https://example.com", "auto")).toEqual({ engine: "lightpanda", reason: "auto" });
		expect(select("http://127.0.0.1:8080/", "auto")).toEqual({ engine: "lightpanda", reason: "auto" });
	});

	it("uses Chromium automatically for what Lightpanda cannot read", () => {
		expect(select("file:///tmp/a.html", "auto")).toEqual({ engine: "chromium", reason: "lightpanda-http-only" });
		expect(select("https://example.com", "auto", false)).toEqual({
			engine: "chromium",
			reason: "lightpanda-not-installed",
		});
	});

	it("honours a forced engine and refuses a forced Lightpanda it cannot satisfy", () => {
		expect(select("https://example.com", "chromium")).toEqual({ engine: "chromium", reason: "requested" });
		expect(select("https://example.com", "lightpanda")).toEqual({ engine: "lightpanda", reason: "requested" });
		expect(() => select("file:///tmp/a.html", "lightpanda")).toThrow(/only HTTP\(S\)/);
		expect(() => select("https://example.com", "lightpanda", false)).toThrow(/not installed/);
	});
});

describe("text reading and fallback", () => {
	it("returns Lightpanda's text without starting Chromium", async () => {
		const readers = { lightpanda: vi.fn(async () => page), chromium: vi.fn(async () => page) };
		const result = await readText(page.url, { engine: "lightpanda", reason: "auto" }, readers, 1000, true);
		expect(result).toMatchObject({ engine: "lightpanda", text: "Hello\n\nworld" });
		expect(result.fallback).toBeUndefined();
		expect(readers.chromium).not.toHaveBeenCalled();
	});

	it("replays a failed Lightpanda read once on Chromium and names the reason", async () => {
		const readers = {
			lightpanda: vi.fn(async () => {
				throw new BrowserEngineError("unsupported-command", "Unknown CDP method", { engine: "lightpanda" });
			}),
			chromium: vi.fn(async () => page),
		};
		const result = await readText(page.url, { engine: "lightpanda", reason: "auto" }, readers, 1000, true);
		expect(result).toMatchObject({
			engine: "chromium",
			fallback: { from: "lightpanda", to: "chromium", reason: "unsupported-command" },
		});
		expect(readers.chromium).toHaveBeenCalledTimes(1);
	});

	it("surfaces the Lightpanda failure when the caller forced that engine", async () => {
		const readers = {
			lightpanda: vi.fn(async () => Promise.reject(new Error("boom"))),
			chromium: vi.fn(async () => page),
		};
		await expect(
			readText(page.url, { engine: "lightpanda", reason: "requested" }, readers, 1000, false),
		).rejects.toThrow("boom");
		expect(readers.chromium).not.toHaveBeenCalled();
	});

	it("errors instead of printing an empty page when an engine returns no text", async () => {
		const readers = { lightpanda: vi.fn(async () => ({ url: "x" })), chromium: vi.fn(async () => null) };
		await expect(readText(page.url, { engine: "chromium", reason: "requested" }, readers, 1000, true)).rejects.toThrow(
			/no readable document text/,
		);
	});

	it("collapses whitespace without merging paragraphs", () => {
		expect(normalizeText("a \t b\r\n\r\n\r\n c ")).toBe("a b\n\nc");
	});
});

describe("Chromium is never the installed Google Chrome", () => {
	it("launches without a channel or executable path and keeps the keychain protection", () => {
		const options = bundledChromiumLaunchOptions(5000);
		expect(options).not.toHaveProperty("channel");
		expect(options).not.toHaveProperty("executablePath");
		expect(options.headless).toBe(true);
		expect(options.args).toEqual(expect.arrayContaining(["--use-mock-keychain", "--password-store=basic"]));
	});

	it("refuses the system Google Chrome and accepts Playwright's own builds", () => {
		expect(() => assertBundledChromium("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", {})).toThrow(
			/Refusing/,
		);
		expect(() => assertBundledChromium("/usr/bin/chromium", {})).toThrow(/Refusing/);
		expect(() =>
			assertBundledChromium(
				"/Users/a/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
				{},
			),
		).not.toThrow();
		expect(() =>
			assertBundledChromium("/opt/pw/chromium-1/chrome", { PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }),
		).not.toThrow();
	});

	it("resolves Playwright's default Chromium to a bundled build on this host", () => {
		expect(() => assertBundledChromium(chromium.executablePath())).not.toThrow();
	});
});
