import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright-core";
import { chromium } from "playwright-core";

export type DoctorCheck = {
	name: string;
	status: "ok" | "warning" | "error";
	message: string;
	fixHint?: string;
};

export type DoctorResult = {
	checks: DoctorCheck[];
	passed: number;
	warnings: number;
	errors: number;
	timestamp: string;
};

const require = createRequire(import.meta.url);

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const HORIZONTAL_LINE = "━".repeat(41);
const MIN_NODE_MAJOR = 18;

function execAsync(command: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, { timeout: 30_000 }, (error, stdout, stderr) => {
			if (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			resolve((stdout || stderr).trim());
		});
	});
}

async function checkNodeVersion(): Promise<DoctorCheck> {
	const major = Number.parseInt(process.version.slice(1).split(".")[0] ?? "0", 10);
	if (major >= MIN_NODE_MAJOR) {
		return { name: "Node.js version", status: "ok", message: process.version };
	}
	return {
		name: "Node.js version",
		status: "error",
		message: `${process.version} (requires >= v${MIN_NODE_MAJOR})`,
		fixHint: "Upgrade Node.js to v18 or later",
	};
}

async function checkPlaywrightInstalled(): Promise<DoctorCheck> {
	try {
		const modPath = require.resolve("playwright-core");
		let version = "unknown";
		try {
			const pkgPath = require.resolve("playwright-core/package.json");
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			version = pkg.version ?? "unknown";
		} catch {
			// Version detection is best-effort.
		}
		const dir = modPath.split("/").slice(0, -2).join("/");
		return { name: "Playwright runtime", status: "ok", message: `v${version} (${dir})` };
	} catch {
		return {
			name: "Playwright runtime",
			status: "error",
			message: "playwright-core not found",
			fixHint: "npm install playwright-core",
		};
	}
}

function chromiumCandidates(): string[] {
	const candidates: string[] = [];
	try {
		const bundled = chromium.executablePath();
		if (bundled) candidates.push(bundled);
	} catch {
		// Fall through to system browser candidates.
	}

	if (platform() === "darwin") {
		candidates.push(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		);
	} else if (platform() === "win32") {
		const programFiles = process.env["PROGRAMFILES"] ?? String.raw`C:\Program Files`;
		const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? String.raw`C:\Program Files (x86)`;
		const localAppData = process.env["LOCALAPPDATA"];
		candidates.push(
			join(programFiles, "Google/Chrome/Application/chrome.exe"),
			join(programFiles, "Chromium/Application/chrome.exe"),
			join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
			join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
			join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
		);
		if (localAppData) candidates.push(join(localAppData, "Google/Chrome/Application/chrome.exe"));
	} else {
		candidates.push(
			"/usr/bin/google-chrome",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/snap/bin/chromium",
			"/opt/google/chrome/chrome",
		);
	}

	return [...new Set(candidates)];
}

async function resolveChromiumExecutable(): Promise<string | null> {
	for (const candidate of chromiumCandidates()) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Candidate does not exist or is inaccessible.
		}
	}
	return null;
}

function checkBrowserBinaries(executablePath: string | null): DoctorCheck {
	if (executablePath) {
		return { name: "Browser binaries", status: "ok", message: executablePath };
	}
	return {
		name: "Browser binaries",
		status: "error",
		message: "Chromium not found",
		fixHint: "npx playwright install chromium",
	};
}

async function installChromium(): Promise<void> {
	console.log(`${DIM}  Fixing: Installing Chromium binaries...${RESET}`);
	try {
		await execAsync("npx", ["playwright", "install", "chromium"]);
		console.log(`${GREEN}  ✓ Chromium installed${RESET}`);
	} catch (err) {
		console.error(
			`${RED}  ✗ Failed to install Chromium: ${err instanceof Error ? err.message : String(err)}${RESET}`,
		);
	}
}

async function checkProfileDirectory(fix: boolean): Promise<DoctorCheck> {
	const profileDir = join(homedir(), "talox-profiles");
	try {
		await access(profileDir);
		await access(profileDir, 2);
		return { name: "Profile directory", status: "ok", message: profileDir };
	} catch {
		if (fix) {
			try {
				await mkdir(profileDir, { recursive: true });
				return { name: "Profile directory", status: "ok", message: `${profileDir} (created)` };
			} catch {
				// mkdir failed; report the original error below.
			}
		}
		return {
			name: "Profile directory",
			status: "error",
			message: `${profileDir} does not exist or is not writable`,
			fixHint: "mkdir -p ~/talox-profiles",
		};
	}
}

async function checkTempDirectory(): Promise<DoctorCheck> {
	const tmp = tmpdir();
	try {
		await access(tmp, 2);
		return { name: "Temp directory", status: "ok", message: tmp };
	} catch {
		return {
			name: "Temp directory",
			status: "error",
			message: `${tmp} is not writable`,
			fixHint: "Ensure your temp directory exists and is writable",
		};
	}
}

async function checkNetworkConnectivity(): Promise<DoctorCheck> {
	try {
		const response = await fetch("https://example.com", {
			signal: AbortSignal.timeout(10_000),
		});
		if (response.ok) {
			return { name: "Network connectivity", status: "ok", message: "example.com reachable" };
		}
		return {
			name: "Network connectivity",
			status: "warning",
			message: `example.com returned HTTP ${response.status}`,
			fixHint: "Check your network connection or proxy settings",
		};
	} catch {
		return {
			name: "Network connectivity",
			status: "error",
			message: "Cannot reach example.com",
			fixHint: "Check your network connection",
		};
	}
}

async function checkDisplayServer(): Promise<DoctorCheck> {
	const plat = platform();
	if (plat === "darwin") {
		return { name: "Display server", status: "ok", message: "macOS — display available" };
	}
	if (plat === "linux") {
		const display = process.env.DISPLAY;
		const wayland = process.env.WAYLAND_DISPLAY;
		if (display || wayland) {
			return {
				name: "Display server",
				status: "ok",
				message: display ? `DISPLAY=${display}` : `WAYLAND=${wayland}`,
			};
		}
		return {
			name: "Display server",
			status: "warning",
			message: "No DISPLAY or WAYLAND_DISPLAY set",
			fixHint: "Set DISPLAY environment variable or run in headless mode",
		};
	}
	if (plat === "win32") {
		return { name: "Display server", status: "ok", message: "Windows — display available" };
	}
	return { name: "Display server", status: "warning", message: `Unknown platform: ${plat}` };
}

async function checkDependencies(): Promise<DoctorCheck> {
	const missing: string[] = [];
	for (const pkg of ["playwright", "fs-extra"]) {
		try {
			require.resolve(pkg);
		} catch {
			missing.push(pkg);
		}
	}

	if (missing.length === 0) {
		return { name: "Dependencies", status: "ok", message: "All key packages resolvable" };
	}
	return {
		name: "Dependencies",
		status: "error",
		message: `Missing: ${missing.join(", ")}`,
		fixHint: `npm install ${missing.join(" ")}`,
	};
}

async function checkConfigFile(fix: boolean): Promise<DoctorCheck> {
	const cwd = process.cwd();
	const candidates = ["talox.config.json", "talox.config.ts"];

	for (const candidate of candidates) {
		try {
			await access(join(cwd, candidate));
			return { name: "Config file", status: "ok", message: join(cwd, candidate) };
		} catch {
			// Continue searching.
		}
	}

	if (fix) {
		const defaultConfig = {
			profileDir: "~/talox-profiles",
			defaultBrowser: "chromium",
			headless: true,
			verbosity: 2,
		};
		const target = join(cwd, "talox.config.json");
		try {
			await writeFile(target, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");
			return { name: "Config file", status: "ok", message: `${target} (created)` };
		} catch {
			// Write failed; report warning below.
		}
	}

	return {
		name: "Config file",
		status: "warning",
		message: "No talox.config.json or talox.config.ts found in CWD",
		fixHint: "Create talox.config.json in your project root",
	};
}

async function checkLiveLaunch(executablePath: string | null): Promise<DoctorCheck> {
	if (!executablePath) {
		return {
			name: "Live launch test",
			status: "error",
			message: "Browser launch skipped because no Chromium executable was found",
			fixHint: "Run 'npx playwright install chromium' to install browser binaries",
		};
	}

	let browser: Browser | undefined;
	try {
		browser = await chromium.launch({ headless: true, executablePath });
		const context: BrowserContext = await browser.newContext();
		const page = await context.newPage();
		await page.goto("about:blank");
		await page.waitForLoadState("load");
		await context.close();
		return {
			name: "Live launch test",
			status: "ok",
			message: `Headless browser launched from ${executablePath} and navigated to about:blank`,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			name: "Live launch test",
			status: "error",
			message: `Browser launch failed: ${msg}`,
			fixHint: "Verify the Chromium executable and required system dependencies",
		};
	} finally {
		await browser?.close();
	}
}

export async function runDoctor(options?: { fix?: boolean }): Promise<DoctorResult> {
	const fix = options?.fix ?? false;
	let chromiumExecutable = await resolveChromiumExecutable();
	let browserCheck = checkBrowserBinaries(chromiumExecutable);

	if (fix && browserCheck.status === "error") {
		await installChromium();
		chromiumExecutable = await resolveChromiumExecutable();
		browserCheck = checkBrowserBinaries(chromiumExecutable);
	}

	const checks: DoctorCheck[] = [
		await checkNodeVersion(),
		await checkPlaywrightInstalled(),
		browserCheck,
		await checkProfileDirectory(fix),
		await checkTempDirectory(),
		await checkNetworkConnectivity(),
		await checkDisplayServer(),
		await checkDependencies(),
		await checkConfigFile(fix),
		await checkLiveLaunch(chromiumExecutable),
	];

	const passed = checks.filter((c) => c.status === "ok").length;
	const warnings = checks.filter((c) => c.status === "warning").length;
	const errors = checks.filter((c) => c.status === "error").length;

	return {
		checks,
		passed,
		warnings,
		errors,
		timestamp: new Date().toISOString(),
	};
}

function statusIcon(status: DoctorCheck["status"]): string {
	if (status === "ok") return "✓";
	if (status === "warning") return "⚠";
	return "✗";
}

function statusColor(status: DoctorCheck["status"]): string {
	if (status === "ok") return GREEN;
	if (status === "warning") return YELLOW;
	return RED;
}

function pluralize(count: number, singular: string): string {
	return count === 1 ? singular : `${singular}s`;
}

function buildSummaryParts(result: DoctorResult): string[] {
	const parts: string[] = [];
	if (result.passed > 0) parts.push(`${GREEN}${result.passed} passed${RESET}`);
	if (result.warnings > 0) parts.push(`${YELLOW}${result.warnings} ${pluralize(result.warnings, "warning")}${RESET}`);
	if (result.errors > 0) parts.push(`${RED}${result.errors} ${pluralize(result.errors, "error")}${RESET}`);
	return parts;
}

function formatCheckLines(checks: DoctorCheck[]): string[] {
	const lines: string[] = [];
	for (const check of checks) {
		const icon = statusIcon(check.status);
		const color = statusColor(check.status);
		const label = check.name.padEnd(24);
		lines.push(`  ${color}${icon}${RESET} ${label} ${check.message}`);
		if (check.fixHint) {
			lines.push(`    ${DIM}→ Fix: ${check.fixHint}${RESET}`);
		}
	}
	return lines;
}

export function formatDoctorOutput(result: DoctorResult, version: string): string {
	const lines: string[] = [];
	lines.push(`Talox Doctor — v${version}`);
	lines.push(HORIZONTAL_LINE);
	lines.push(...formatCheckLines(result.checks));
	lines.push(HORIZONTAL_LINE);
	lines.push(`  ${buildSummaryParts(result).join(" · ")}`);
	return lines.join("\n");
}
