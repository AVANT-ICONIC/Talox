import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, LaunchOptions } from "playwright-core";
import { chromeLaunchArgs } from "../core/browser/ChromeLaunchArgs.js";
import { LightpandaEngine } from "../core/browser/LightpandaEngine.js";
import type { EngineName } from "../core/browser/types.js";

/**
 * One-shot browser commands for agents: no script, no profile, no system Chrome.
 * Chromium is always Playwright's own bundled build with a mock keychain and a
 * temporary profile, so no command can raise a macOS Keychain dialog. `text`
 * reads through Lightpanda when it is installed and the target is HTTP(S).
 */
export type AgentBrowserCommand = "pdf" | "shot" | "text";
export type TextEngineChoice = EngineName | "auto";

export const PDF_FORMATS = ["Letter", "Legal", "Tabloid", "Ledger", "A0", "A1", "A2", "A3", "A4", "A5", "A6"] as const;
export type PdfFormat = (typeof PDF_FORMATS)[number];

export interface AgentBrowserOptions {
	command: AgentBrowserCommand;
	target?: string;
	output?: string;
	pdfFormat?: PdfFormat;
	viewport: { width: number; height: number };
	scale: number;
	fullPage: boolean;
	engine: TextEngineChoice;
	json: boolean;
	timeoutMs: number;
	help: boolean;
}

const COMMANDS = new Set<string>(["pdf", "shot", "text"]);

const HELP = `Talox agent browser commands

Usage:
  talox pdf  <file-or-url> <out.pdf> [--size Letter|A4|...]
  talox shot <file-or-url> <out.png> [--size WxH] [--scale N] [--full]
  talox text <file-or-url> [--engine auto|lightpanda|chromium] [--json]

Options:
  --size <value>      pdf: paper format (default: the page's CSS @page size, else Letter)
                      shot: viewport WxH (default: 1280x720)
  --scale <n>         shot: device scale factor (default: 1)
  --full              shot: capture the full scrollable page
  --engine <name>     text: auto (default) reads HTTP(S) through Lightpanda when
                      installed and falls back to Chromium; lightpanda or chromium
                      forces one engine
  --json              text: print {engine, fallback, url, title, text} as JSON
  --timeout <ms>      Navigation deadline (default: 30000)
  --help, -h          Show this help

Chromium is Playwright's bundled build (never the installed Google Chrome),
launched headless with a temporary profile, --use-mock-keychain and
--password-store=basic. Lightpanda is found at TALOX_LIGHTPANDA_PATH or
~/.cache/talox/lightpanda/1.0.0/lightpanda (install: node scripts/install-lightpanda.mjs
--cache-dir ~/.cache/talox/lightpanda).
`;

export class AgentBrowserUsageError extends Error {
	override name = "AgentBrowserUsageError";
}

export function shouldUseAgentBrowserCommand(argv: readonly string[]): boolean {
	return COMMANDS.has(argv[0] ?? "");
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (value === undefined || value.startsWith("--")) throw new AgentBrowserUsageError(`${flag} requires a value.`);
	return value;
}

function parseViewport(value: string): { width: number; height: number } {
	const match = /^(\d{1,5})x(\d{1,5})$/i.exec(value);
	const width = Number(match?.[1]);
	const height = Number(match?.[2]);
	if (!match || width < 1 || height < 1 || width > 16_384 || height > 16_384)
		throw new AgentBrowserUsageError(`--size must be WxH with each side 1..16384, got "${value}".`);
	return { width, height };
}

function parsePdfFormat(value: string): PdfFormat {
	const format = PDF_FORMATS.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
	if (!format)
		throw new AgentBrowserUsageError(`--size for pdf must be one of ${PDF_FORMATS.join(", ")}, got "${value}".`);
	return format;
}

function parsePositive(value: string, flag: string, max: number): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0 || number > max)
		throw new AgentBrowserUsageError(`${flag} must be a number in (0, ${max}], got "${value}".`);
	return number;
}

export function parseAgentBrowserArgs(argv: readonly string[]): AgentBrowserOptions {
	const command = argv[0];
	if (!command || !COMMANDS.has(command)) throw new AgentBrowserUsageError(`Unknown command: ${command ?? "(none)"}`);
	const options: AgentBrowserOptions = {
		command: command as AgentBrowserCommand,
		viewport: { width: 1280, height: 720 },
		scale: 1,
		fullPage: false,
		engine: "auto",
		json: false,
		timeoutMs: 30_000,
		help: false,
	};
	const positional: string[] = [];
	for (let i = 1; i < argv.length; i += 1) {
		const arg = argv[i]!;
		switch (arg) {
			case "--help":
			case "-h":
				options.help = true;
				break;
			case "--size": {
				const value = requireValue(argv, i, arg);
				if (options.command === "pdf") options.pdfFormat = parsePdfFormat(value);
				else if (options.command === "shot") options.viewport = parseViewport(value);
				else throw new AgentBrowserUsageError("--size applies to pdf and shot only.");
				i += 1;
				break;
			}
			case "--scale":
				options.scale = parsePositive(requireValue(argv, i, arg), arg, 4);
				i += 1;
				break;
			case "--full":
				options.fullPage = true;
				break;
			case "--engine": {
				const value = requireValue(argv, i, arg);
				if (value !== "auto" && value !== "lightpanda" && value !== "chromium")
					throw new AgentBrowserUsageError(`--engine must be auto, lightpanda or chromium, got "${value}".`);
				options.engine = value;
				i += 1;
				break;
			}
			case "--json":
				options.json = true;
				break;
			case "--timeout":
				options.timeoutMs = parsePositive(requireValue(argv, i, arg), arg, 600_000);
				i += 1;
				break;
			default:
				if (arg.startsWith("--")) throw new AgentBrowserUsageError(`Unknown option for ${options.command}: ${arg}`);
				positional.push(arg);
		}
	}
	if (options.help) return options;
	const expected = options.command === "text" ? 1 : 2;
	if (positional.length !== expected)
		throw new AgentBrowserUsageError(
			options.command === "text"
				? "text needs exactly one <file-or-url>."
				: `${options.command} needs <file-or-url> and <output>, got ${positional.length} argument(s).`,
		);
	options.target = positional[0]!;
	if (positional[1] !== undefined) options.output = positional[1];
	return options;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A URL stays a URL; anything else must be an existing local file. */
export async function resolveTarget(target: string, cwd: string = process.cwd()): Promise<string> {
	if (SCHEME.test(target) && !/^[a-z]:[\\/]/i.test(target)) {
		const url = new URL(target);
		if (!["http:", "https:", "file:", "data:", "about:"].includes(url.protocol))
			throw new AgentBrowserUsageError(`Unsupported URL scheme: ${url.protocol}`);
		return url.href;
	}
	const absolute = path.resolve(cwd, target);
	try {
		if (!(await stat(absolute)).isFile()) throw new Error("not a file");
	} catch {
		throw new AgentBrowserUsageError(`No such file: ${absolute}`);
	}
	return pathToFileURL(absolute).href;
}

export function defaultLightpandaPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
	return env.TALOX_LIGHTPANDA_PATH || path.join(home, ".cache", "talox", "lightpanda", "1.0.0", "lightpanda");
}

export async function isExecutable(file: string): Promise<boolean> {
	try {
		await access(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export interface EngineSelection {
	engine: EngineName;
	reason: string;
}

/** Lightpanda reads whenever it can; Chromium covers what Lightpanda cannot do. */
export function selectTextEngine(input: {
	url: string;
	engine: TextEngineChoice;
	lightpandaInstalled: boolean;
}): EngineSelection {
	if (input.engine === "chromium") return { engine: "chromium", reason: "requested" };
	const protocol = new URL(input.url).protocol;
	const httpTarget = protocol === "http:" || protocol === "https:";
	if (input.engine === "lightpanda") {
		if (!httpTarget) throw new AgentBrowserUsageError(`Lightpanda reads only HTTP(S) URLs, got ${protocol}`);
		if (!input.lightpandaInstalled)
			throw new AgentBrowserUsageError(
				"Lightpanda is not installed: node scripts/install-lightpanda.mjs --cache-dir ~/.cache/talox/lightpanda",
			);
		return { engine: "lightpanda", reason: "requested" };
	}
	if (!httpTarget) return { engine: "chromium", reason: "lightpanda-http-only" };
	if (!input.lightpandaInstalled) return { engine: "chromium", reason: "lightpanda-not-installed" };
	return { engine: "lightpanda", reason: "auto" };
}

/**
 * Launch options for every Chromium this module starts. No channel and no
 * executablePath: Playwright resolves its own bundled build, never the
 * installed Google Chrome whose real keychain integration raises dialogs.
 */
export function bundledChromiumLaunchOptions(timeoutMs: number): LaunchOptions {
	return {
		headless: true,
		timeout: timeoutMs,
		args: chromeLaunchArgs(["--no-first-run", "--no-default-browser-check", "--disable-sync"]),
	};
}

export interface BundledChromium {
	browser: Browser;
	/** Closes within closeGraceMs, then kills the process group and its temporary profile. */
	dispose(): Promise<void>;
}

/**
 * Measured 2026-10-16 on macOS 27 with Chromium 151: a graceful close leaves the
 * browser process spinning for Playwright's whole 30 s grace, with every flag set
 * and on both bundled builds. A one-shot command has already written its output,
 * so it closes with a short deadline and then kills the server it owns.
 */
export async function launchBundledChromium(timeoutMs: number, closeGraceMs = 250): Promise<BundledChromium> {
	const { chromium } = await import("playwright-core");
	assertBundledChromium(chromium.executablePath());
	const server = await chromium.launchServer(bundledChromiumLaunchOptions(timeoutMs));
	let browser: Browser;
	try {
		browser = await chromium.connect(server.wsEndpoint(), { timeout: timeoutMs });
	} catch (error) {
		await server.kill();
		throw error;
	}
	return {
		browser,
		async dispose() {
			let timer: NodeJS.Timeout | undefined;
			const closed = server.close().then(
				() => true,
				() => false,
			);
			const deadline = new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), closeGraceMs);
			});
			const graceful = await Promise.race([closed, deadline]);
			clearTimeout(timer);
			if (!graceful) await server.kill();
		},
	};
}

/** The installed Google Chrome is never an acceptable executable, however it was configured. */
export function assertBundledChromium(executable: string, env: NodeJS.ProcessEnv = process.env): void {
	const browsersPath = env.PLAYWRIGHT_BROWSERS_PATH;
	const bundled =
		executable.includes(`${path.sep}ms-playwright${path.sep}`) ||
		executable.includes(`${path.sep}.local-browsers${path.sep}`) ||
		(!!browsersPath && browsersPath !== "0" && executable.startsWith(path.resolve(browsersPath) + path.sep));
	if (!bundled || /\/Google Chrome\.app\//.test(executable))
		throw new Error(`Refusing a Chromium outside Playwright's bundled browsers: ${executable}`);
}

/** Text without script, style or template bodies; both engines run the same expression. */
export const READABLE_TEXT_EXPRESSION = `(() => {
  if (!document.body) throw new Error('No usable HTML document body');
  const copy = document.body.cloneNode(true);
  for (const node of Array.from(copy.querySelectorAll('script,style,noscript,template'))) node.remove();
  for (const node of Array.from(copy.querySelectorAll('address,article,aside,blockquote,br,dd,div,dl,dt,figcaption,footer,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,tr,ul'))) node.appendChild(document.createTextNode('\\n'));
  for (const node of Array.from(copy.querySelectorAll('td,th'))) node.appendChild(document.createTextNode('\\t'));
  return { url: location.href, title: document.title, text: copy.textContent ?? '' };
})()`;

export interface ReadableText {
	url: string;
	title: string;
	text: string;
}

export function normalizeText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function asReadable(value: unknown): ReadableText {
	const record = value as Partial<ReadableText> | null;
	if (!record || typeof record.text !== "string") throw new Error("Engine returned no readable document text");
	return { url: String(record.url ?? ""), title: String(record.title ?? ""), text: normalizeText(record.text) };
}

export interface TextReaders {
	lightpanda(url: string, timeoutMs: number): Promise<unknown>;
	chromium(url: string, timeoutMs: number): Promise<unknown>;
}

export interface TextResult extends ReadableText {
	engine: EngineName;
	selection: string;
	fallback?: { from: EngineName; to: EngineName; reason: string };
}

/** A failed Lightpanda read is replayed once on Chromium; reading has no side effect to repeat. */
export async function readText(
	url: string,
	selection: EngineSelection,
	readers: TextReaders,
	timeoutMs: number,
	allowFallback: boolean,
): Promise<TextResult> {
	if (selection.engine === "chromium")
		return { engine: "chromium", selection: selection.reason, ...asReadable(await readers.chromium(url, timeoutMs)) };
	try {
		return {
			engine: "lightpanda",
			selection: selection.reason,
			...asReadable(await readers.lightpanda(url, timeoutMs)),
		};
	} catch (error) {
		if (!allowFallback) throw error;
		const reason = (error as { code?: string }).code ?? (error instanceof Error ? error.message : String(error));
		return {
			engine: "chromium",
			selection: selection.reason,
			fallback: { from: "lightpanda", to: "chromium", reason },
			...asReadable(await readers.chromium(url, timeoutMs)),
		};
	}
}

export function lightpandaReader(executablePath: string): TextReaders["lightpanda"] {
	return async (url, timeoutMs) => {
		const engine = new LightpandaEngine({ executablePath });
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await engine.execute(
				{
					url,
					operation: "evaluate",
					expression: READABLE_TEXT_EXPRESSION,
					readOnly: true,
					trustedContent: true,
					timeoutMs,
				},
				controller.signal,
			);
		} finally {
			clearTimeout(timer);
			await engine.close();
		}
	};
}

async function withPage<T>(
	timeoutMs: number,
	contextOptions: { viewport?: { width: number; height: number }; deviceScaleFactor?: number },
	url: string,
	run: (page: import("playwright-core").Page) => Promise<T>,
): Promise<T> {
	const { browser, dispose } = await launchBundledChromium(timeoutMs);
	try {
		const context = await browser.newContext(contextOptions);
		const page = await context.newPage();
		await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
		await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
		return await run(page);
	} finally {
		await dispose();
	}
}

export const chromiumReader: TextReaders["chromium"] = (url, timeoutMs) =>
	withPage(timeoutMs, {}, url, (page) => page.evaluate(READABLE_TEXT_EXPRESSION));

async function ensureParent(file: string): Promise<string> {
	const absolute = path.resolve(file);
	await mkdir(path.dirname(absolute), { recursive: true });
	return absolute;
}

export async function writePdf(url: string, output: string, format: PdfFormat | undefined, timeoutMs: number) {
	const file = await ensureParent(output);
	await withPage(timeoutMs, {}, url, async (page) => {
		await page.pdf({
			path: file,
			format: format ?? "Letter",
			preferCSSPageSize: format === undefined,
			printBackground: true,
		});
	});
	return file;
}

export async function writeShot(
	url: string,
	output: string,
	viewport: { width: number; height: number },
	scale: number,
	fullPage: boolean,
	timeoutMs: number,
) {
	const file = await ensureParent(output);
	await withPage(timeoutMs, { viewport, deviceScaleFactor: scale }, url, async (page) => {
		await page.screenshot({
			path: file,
			fullPage,
			type: file.toLowerCase().endsWith(".jpg") || file.toLowerCase().endsWith(".jpeg") ? "jpeg" : "png",
		});
	});
	return file;
}

export async function runAgentBrowserCommand(argv: readonly string[]): Promise<void> {
	let options: AgentBrowserOptions;
	try {
		options = parseAgentBrowserArgs(argv);
	} catch (error) {
		console.error(`[Talox] ${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
		process.exitCode = 2;
		return;
	}
	if (options.help) {
		console.log(HELP);
		return;
	}
	try {
		const url = await resolveTarget(options.target!);
		if (options.command === "pdf") {
			console.log(await writePdf(url, options.output!, options.pdfFormat, options.timeoutMs));
			return;
		}
		if (options.command === "shot") {
			console.log(
				await writeShot(url, options.output!, options.viewport, options.scale, options.fullPage, options.timeoutMs),
			);
			return;
		}
		const lightpandaPath = defaultLightpandaPath();
		const selection = selectTextEngine({
			url,
			engine: options.engine,
			lightpandaInstalled: await isExecutable(lightpandaPath),
		});
		const result = await readText(
			url,
			selection,
			{ lightpanda: lightpandaReader(lightpandaPath), chromium: chromiumReader },
			options.timeoutMs,
			options.engine === "auto",
		);
		if (options.json) console.log(JSON.stringify(result, null, 2));
		else {
			if (result.fallback) console.error(`[Talox] lightpanda failed (${result.fallback.reason}); read with chromium`);
			console.log(result.text);
		}
	} catch (error) {
		console.error(`[Talox] ${options.command} failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = error instanceof AgentBrowserUsageError ? 2 : 1;
	}
}
