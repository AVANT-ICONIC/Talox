import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadReplayBundle } from "../core/replay/ReplayLoader.js";
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
./talox-sessions.
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
	await fs.writeFile(outputPath, renderReplayHtml(bundle), "utf-8");

	const replayUrl = pathToFileURL(outputPath).href;
	process.stdout.write(`[Talox] Replay ready: ${replayUrl}\n`);
	if (options.open) openInBrowser(outputPath);
}
