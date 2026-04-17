import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext } from "playwright-core";

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
				reject(error);
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
		const modPath = require.resolve("@playwright/test");
		let version = "unknown";
		try {
			const pkgPath = require.resolve("@playwright/test/package.json");
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			version = pkg.version ?? "unknown";
		} catch {
			// NOSONAR — version detection is best-effort
		}
		const dir = modPath.split("/").slice(0, -2).join("/");
		return { name: "Playwright installed", status: "ok", message: `v${version} (${dir})` };
	} catch {
		// NOSONAR
		return {
			name: "Playwright installed",
			status: "error",
			message: "@playwright/test not found",
			fixHint: "npm install -D @playwright/test",
		};
	}
}

async function checkBrowserBinaries(): Promise<DoctorCheck> {
	try {
		const output = await execAsync("npx", ["playwright", "install", "--dry-run"]);
		if (output.toLowerCase().includes("chromium")) {
			return { name: "Browser binaries", status: "ok", message: "Chromium available" };
		}
	} catch {
		// NOSONAR — dry-run failed, try fallback detection
	}

	const candidates = [
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/snap/bin/chromium",
		join(homedir(), ".cache/ms-playwright"),
	];

	for (const candidate of candidates) {
		try {
			await access(candidate);
			return { name: "Browser binaries", status: "ok", message: candidate };
		} catch {
			// NOSONAR — candidate not found, continue
		}
	}

	return {
		name: "Browser binaries",
		status: "error",
		message: "Chromium not found",
		fixHint: "npx playwright install chromium",
	};
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
				// NOSONAR — mkdir failed
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
		// NOSONAR
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
			// NOSONAR
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
			// NOSONAR — not found, continue
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
			// NOSONAR — write failed
		}
	}

	return {
		name: "Config file",
		status: "warning",
		message: "No talox.config.json or talox.config.ts found in CWD",
		fixHint: "Create talox.config.json in your project root",
	};
}

async function checkLiveLaunch(): Promise<DoctorCheck> {
	let browser: Browser | undefined;
	try {
		browser = await chromium.launch({ headless: true });
		const context: BrowserContext = await browser.newContext();
		const page = await context.newPage();
		await page.goto("about:blank");
		await page.waitForLoadState("load");
		await context.close();
		return {
			name: "Live launch test",
			status: "ok",
			message: "Headless browser launched and navigated to about:blank",
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			name: "Live launch test",
			status: "error",
			message: `Browser launch failed: ${msg}`,
			fixHint: "Run 'npx playwright install chromium' to install browser binaries",
		};
	} finally {
		await browser?.close();
	}
}

async function applyFixes(checks: DoctorCheck[]): Promise<void> {
	for (const check of checks) {
		if (check.status === "error" && check.name === "Browser binaries") {
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
	}
}

export async function runDoctor(options?: { fix?: boolean }): Promise<DoctorResult> {
	const fix = options?.fix ?? false;

	const checks: DoctorCheck[] = [
		await checkNodeVersion(),
		await checkPlaywrightInstalled(),
		await checkBrowserBinaries(),
		await checkProfileDirectory(fix),
		await checkTempDirectory(),
		await checkNetworkConnectivity(),
		await checkDisplayServer(),
		await checkDependencies(),
		await checkConfigFile(fix),
		await checkLiveLaunch(),
	];

	if (fix) {
		await applyFixes(checks);
	}

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

export function formatDoctorOutput(result: DoctorResult, version: string): string {
	const lines: string[] = [];
	lines.push(`Talox Doctor — v${version}`);
	lines.push(HORIZONTAL_LINE);

	for (const check of result.checks) {
		const icon = check.status === "ok" ? "✓" : check.status === "warning" ? "⚠" : "✗";
		const color = check.status === "ok" ? GREEN : check.status === "warning" ? YELLOW : RED;
		const label = check.name.padEnd(24);
		lines.push(`  ${color}${icon}${RESET} ${label} ${check.message}`);
		if (check.fixHint) {
			lines.push(`    ${DIM}→ Fix: ${check.fixHint}${RESET}`);
		}
	}

	lines.push(HORIZONTAL_LINE);
	const summaryParts: string[] = [];
	if (result.passed > 0) summaryParts.push(`${GREEN}${result.passed} passed${RESET}`);
	if (result.warnings > 0) summaryParts.push(`${YELLOW}${result.warnings} warning${result.warnings > 1 ? "s" : ""}${RESET}`);
	if (result.errors > 0) summaryParts.push(`${RED}${result.errors} error${result.errors > 1 ? "s" : ""}${RESET}`);
	lines.push(`  ${summaryParts.join(" · ")}`);

	return lines.join("\n");
}
