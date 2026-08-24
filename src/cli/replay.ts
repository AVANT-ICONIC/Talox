import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadReplayBundle, type ReplayBundle } from "../core/replay/ReplayLoader.js";
import { renderReplayHtml } from "../core/replay/ReplayRenderer.js";

export interface ReplayCommandOptions {
	inputPath?: string;
	outputPath?: string;
	open: boolean;
	help: boolean;
}

const HELP = `Talox Replay

Usage:
  talox replay [session-dir | report.json] [--output replay.html] [--open]

Options:
  --output, -o <path>  Write the replay UI to a custom path
  --open               Open the generated replay in the system browser
  --help, -h           Show this help

When no session path is supplied, Talox uses the newest session directory in
./talox-sessions. When a custom output directory is used, referenced replay
screenshots are copied into a sibling .talox-replay-assets directory.
`;

export function shouldUseReplayCommand(argv: readonly string[]): boolean {
	return argv[0] === "replay";
}

export function parseReplayArgs(argv: readonly string[]): ReplayCommandOptions {
	const options: ReplayCommandOptions = { open: false, help: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]!;
		if (arg === "--help" || arg === "-h") {
			options.help = true;
			continue;
		}
		if (arg === "--open") {
			options.open = true;
			continue;
		}
		if (arg === "--output" || arg === "-o") {
			const value = argv[i + 1];
			if (!value || value.startsWith("-")) throw new Error(`${arg} requires a path.`);
			options.outputPath = value;
			i += 1;
			continue;
		}
		if (arg.startsWith("-")) throw new Error(`Unknown replay option: ${arg}`);
		if (options.inputPath) throw new Error(`Unexpected replay argument: ${arg}`);
		options.inputPath = arg;
	}
	return options;
}

async function newestSession(root: string): Promise<string> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`No Talox sessions found in ${root}.`);
		}
		throw error;
	}

	const candidates = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && entry.name.startsWith("session-"))
			.map(async (entry) => {
				const fullPath = path.join(root, entry.name);
				const stat = await fs.stat(fullPath);
				return { fullPath, modified: stat.mtimeMs };
			}),
	);
	candidates.sort((a, b) => b.modified - a.modified);
	if (!candidates[0]) throw new Error(`No Talox sessions found in ${root}.`);
	return candidates[0].fullPath;
}

function openInBrowser(filePath: string): void {
	const url = pathToFileURL(filePath).href;
	let command: string;
	let args: string[];
	if (process.platform === "darwin") {
		command = "open";
		args = [url];
	} else if (process.platform === "win32") {
		command = "cmd";
		args = ["/c", "start", "", url];
	} else {
		command = "xdg-open";
		args = [url];
	}
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.unref();
}

function isEmbeddedScreenshot(value: string): boolean {
	return value.startsWith("data:image/png;base64,") || /^[A-Za-z0-9+/=]{100,}$/.test(value);
}

function isPathInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function copyScreenshotReference(
	reference: string | undefined,
	bundle: ReplayBundle,
	outputDir: string,
	assetDir: string,
	assetName: string,
): Promise<string | undefined> {
	if (!reference || isEmbeddedScreenshot(reference)) return reference;
	if (path.isAbsolute(reference) || reference.includes(":")) return undefined;

	const source = path.resolve(bundle.sessionDir, reference);
	if (!isPathInside(bundle.sessionDir, source)) return undefined;
	try {
		const stat = await fs.stat(source);
		if (!stat.isFile()) return undefined;
	} catch {
		return undefined;
	}

	const extension = path.extname(source).toLowerCase();
	if (extension !== ".png") return undefined;
	await fs.mkdir(assetDir, { recursive: true });
	const destination = path.join(assetDir, `${assetName}.png`);
	await fs.copyFile(source, destination);
	return path.relative(outputDir, destination).split(path.sep).join("/");
}

async function prepareBundleForOutput(bundle: ReplayBundle, outputPath: string): Promise<ReplayBundle> {
	const outputDir = path.dirname(outputPath);
	if (path.resolve(outputDir) === path.resolve(bundle.sessionDir)) return bundle;

	const copied: ReplayBundle = structuredClone(bundle);
	const assetDir = path.join(outputDir, ".talox-replay-assets");
	for (let i = 0; i < copied.report.interactions.length; i += 1) {
		const interaction = copied.report.interactions[i]!;
		const original = bundle.report.interactions[i]!;
		interaction.screenshotBefore = await copyScreenshotReference(
			original.screenshotBefore,
			bundle,
			outputDir,
			assetDir,
			`${interaction.index}-before`,
		);
		interaction.screenshotAfter = await copyScreenshotReference(
			original.screenshotAfter,
			bundle,
			outputDir,
			assetDir,
			`${interaction.index}-after`,
		);
	}
	return copied;
}

export async function runReplayCommand(argv: readonly string[]): Promise<void> {
	const options = parseReplayArgs(argv);
	if (options.help) {
		process.stdout.write(HELP);
		return;
	}

	const input = options.inputPath ?? (await newestSession(path.join(process.cwd(), "talox-sessions")));
	const bundle = await loadReplayBundle(input);
	const outputPath = path.resolve(options.outputPath ?? path.join(bundle.sessionDir, "replay.html"));
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	const renderBundle = await prepareBundleForOutput(bundle, outputPath);
	await fs.writeFile(outputPath, renderReplayHtml(renderBundle), "utf-8");

	const replayUrl = pathToFileURL(outputPath).href;
	process.stdout.write(`[Talox] Replay ready: ${replayUrl}\n`);
	if (options.open) openInBrowser(outputPath);
}
