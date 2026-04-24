import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type BrowserContext, chromium, firefox, webkit } from "playwright-core";
import type { TaloxProfile, TaloxSettings } from "../types/index.js";

export type BrowserType = "chromium" | "firefox" | "webkit";

export interface DetectedBrowser {
	type: BrowserType;
	channel: string | undefined;
	executablePath: string | undefined;
	version: string | undefined;
}

interface BrowserExecutable {
	path: string;
	version: string | undefined;
}

export interface TaloxConfig {
	browser: {
		autoDetect: boolean;
		preferred: BrowserType;
		headless: boolean;
		proxy?: {
			server: string;
			username?: string;
			password?: string;
		};
	};
	profile: {
		vaultDir: string;
		defaultClass: "qa" | "ops" | "sandbox";
	};
	settings: TaloxSettings;
}

export const DEFAULT_CONFIG: TaloxConfig = {
	browser: {
		autoDetect: true,
		preferred: "chromium",
		headless: true,
	},
	profile: {
		vaultDir: ".talox-profiles",
		defaultClass: "qa",
	},
	settings: {
		mouseSpeed: 1,
		typingDelayMin: 50,
		typingDelayMax: 150,
		stealthLevel: "medium",
		perceptionDepth: "full",
		fidgetEnabled: true,
		humanStealth: 0.5,
		typoProbability: 0.05,
		adaptiveStealthEnabled: true,
		adaptiveStealthSensitivity: 1,
		adaptiveStealthRadius: 50,
		precisionDecay: 0.1,
		automaticThinkingEnabled: true,
		idleTimeout: 3000,
		headed: false,
		autoHeadedEscalation: true,
		verbosity: 0,
		humanTakeoverEnabled: false,
		humanTakeoverTimeoutMs: 120000,
		safeMode: false,
		autoDialogHandling: true,
		sessionIdleTimeoutMs: 300000,
		enableCrossOriginIframes: false,
	},
};

export function getDefaultConfig(): TaloxConfig {
	const cfg = structuredClone(DEFAULT_CONFIG);
	// TALOX_HEADLESS=false is an emergency escape hatch to force headed mode
	// regardless of mode. Prefer using { headed: true } in launch() options instead.
	if (process.env.TALOX_HEADLESS === "false") {
		cfg.browser.headless = false;
	}
	return cfg;
}

export function resolveConfigDir(): string {
	return process.cwd();
}

/**
 * Manages browser lifecycle and context creation. Handles browser auto-detection
 * across platforms, launches persistent Playwright contexts (with optional
 * Patchright stealth driver), supports proxy configuration, and tracks all
 * open contexts for clean teardown on exit.
 */
interface LaunchOptions {
	headless: boolean;
	browserType: BrowserType;
	proxy?: { server: string; username?: string; password?: string };
	userDataDir?: string;
	args?: string[];
	extensions?: string[];
}

export class BrowserManager {
	private context: BrowserContext | null = null;
	private config: TaloxConfig;
	private detectedBrowsers: DetectedBrowser[] = [];
	private launchOptionsHash: string | null = null;

	private readonly contexts: Set<BrowserContext> = new Set();

	constructor(config?: Partial<TaloxConfig>) {
		this.config = { ...getDefaultConfig(), ...config };

		// Auto-cleanup on process exit — use once() so multiple instances don't
		// stack unbounded listeners (avoids MaxListenersExceededWarning in tests).
		const exitHandler = () => this.closeAllSync();
		const sigintHandler = () => {
			this.closeAllSync();
			process.exit();
		};
		process.once("exit", exitHandler);
		process.once("SIGINT", sigintHandler);
	}

	private closeAllSync() {
		// Synchronous cleanup is limited, but we try our best
		for (const ctx of this.contexts) {
			try {
				// @ts-expect-error - internal close
				ctx._browser?.close().catch(() => {});
			} catch { /* NOSONAR */ }
		}
	}

	async closeAll() {
		const promises = Array.from(this.contexts).map((ctx) => ctx.close());
		await Promise.all(promises);
		this.contexts.clear();
		this.context = null;
	}

	async detectBrowsers(): Promise<DetectedBrowser[]> {
		const browsers: DetectedBrowser[] = [];
		const searchPaths = this.getSearchPaths();

		for (const [type, channel] of [
			["chromium", "chrome"],
			["chromium", "msedge"],
			["chromium", undefined],
			["firefox", "firefox"],
			["firefox", undefined],
			["webkit", "webkit"],
		] as const) {
			try {
				const executable = await this.findBrowser(type, channel ?? undefined, searchPaths);
				if (executable) {
					const existing = browsers.find((b) => b.type === type && (b.channel === channel || (!b.channel && !channel)));
					if (!existing) {
						browsers.push({
							type,
							channel: channel ?? undefined,
							executablePath: executable.path,
							version: executable.version,
						});
					}
				}
			} catch { // NOSONAR -- non-fatal
				// Continue searching
			}
		}

		this.detectedBrowsers = browsers;
		return browsers;
	}

	private getSearchPaths(): string[] {
		const paths: string[] = [];
		const platform = process.platform;

		if (platform === "darwin") {
			paths.push(
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				"/Applications/Chromium.app/Contents/MacOS/Chromium",
				"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
				"/Applications/Firefox.app/Contents/MacOS/firefox",
				"/Applications/Safari.app/Contents/MacOS/Safari",
				path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
				path.join(os.homedir(), "Library/Application Support/Chromium"),
				path.join(os.homedir(), "Library/Application Support/Microsoft Edge"),
				path.join(os.homedir(), "Library/Application Support/Firefox"),
			);
		} else if (platform === "win32") {
			const programFiles = process.env["PROGRAMFILES"] || String.raw`C:\Program Files`;
			const programFilesX86 = process.env["PROGRAMFILES(X86)"] || String.raw`C:\Program Files (x86)`;
			paths.push(
				path.join(programFiles, "Google/Chrome/Application/chrome.exe"),
				path.join(programFiles, "Chromium/chrome.exe"),
				path.join(programFiles, "Microsoft/Edge/Application/msedge.exe"),
				path.join(programFiles, "Mozilla Firefox/firefox.exe"),
				path.join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
				path.join(programFilesX86, "Microsoft/Edge/Application/msedge.exe"),
			);
		} else {
			paths.push(
				"/usr/bin/google-chrome",
				"/usr/bin/chromium",
				"/usr/bin/chromium-browser",
				"/usr/bin/firefox",
				"/usr/bin/safari",
				"/snap/bin/chromium",
				"/opt/google/chrome/chrome",
				path.join(os.homedir(), ".config/google-chrome"),
				path.join(os.homedir(), ".config/chromium"),
				path.join(os.homedir(), ".mozilla/firefox"),
			);
		}

		const playwrightPath = path.join(os.homedir(), ".cache", "ms-playwright");
		if (fs.existsSync(playwrightPath)) {
			try {
				const dirs = fs.readdirSync(playwrightPath);
				for (const dir of dirs) {
					const browserDir = path.join(playwrightPath, dir);
					if (fs.statSync(browserDir).isDirectory()) {
						paths.push(browserDir);
					}
				}
			} catch { // NOSONAR -- non-fatal
				// Ignore cache errors
			}
		}

		return paths;
	}

	private async findBrowser(
		type: BrowserType,
		channel: string | undefined,
		searchPaths: string[],
	): Promise<BrowserExecutable | null> {
		try {
			const launcher = { chromium, firefox, webkit }[type];
			const options: any = {
				channel,
				timeout: 5000,
			};

			if (channel) {
				try {
					const browser = await launcher.launch({ ...options, headless: true });
					await browser.close();
					return { path: channel, version: undefined };
				} catch { // NOSONAR -- non-fatal
					// Try without channel
				}
			}

			for (const searchPath of searchPaths) {
				if (fs.existsSync(searchPath)) {
					try {
						const testOptions = { ...options, executablePath: searchPath, headless: true };
						const browser = await launcher.launch(testOptions);
						await browser.close();
						return { path: searchPath, version: undefined };
					} catch { /* NOSONAR */ }
				}
			}

			return null;
		} catch { // NOSONAR -- non-fatal
			return null;
		}
	}

	async autoDetectBrowser(): Promise<BrowserType> {
		if (this.detectedBrowsers.length === 0) {
			await this.detectBrowsers();
		}

		if (this.detectedBrowsers.length === 0) {
			throw new Error(
				"NO_BROWSERS_FOUND: No browsers detected. Please install Chrome, Firefox, Safari, or Edge. Run: npx playwright install",
			);
		}

		const preferred = this.config.browser.preferred;
		const found = this.detectedBrowsers.find((b) => b.type === preferred);
		if (found) return preferred;

		return this.detectedBrowsers[0]?.type ?? "chromium";
	}

	getDetectedBrowsers(): DetectedBrowser[] {
		return this.detectedBrowsers;
	}

	getConfig(): TaloxConfig {
		return this.config;
	}

	updateConfig(config: Partial<TaloxConfig>): void {
		this.config = { ...this.config, ...config };
	}

	private attachCloseHandler(ctx: BrowserContext): void {
		ctx.on("close", () => {
			this.contexts.delete(ctx);
			if (this.context === ctx) this.context = null;
		});
	}

	private resolveLauncher(actualBrowserType: BrowserType, _isAdaptive: boolean): any {
		// Use standard playwright-core with channel: "chrome" for all browser types.
		// Patchright's addInitScript is broken (callback never executes), which means
		// the entire 19-patch JS stealth stack never gets injected. Regular playwright-core
		// + channel: "chrome" (system Chrome) + our stealth scripts achieves 31/31 Sannysoft,
		// GitHub login, Reddit (with warmup), and Cloudflare bypass.
		//
		// Patchright is still available via explicit browserType override if needed,
		// but it's no longer the default because its broken addInitScript is a dealbreaker.
		return { chromium, firefox, webkit }[actualBrowserType];
	}

	private buildLaunchOptions(extraOptions: any): any {
		const effectiveHeadless = extraOptions?.headless ?? this.config.browser.headless;
		const isAdaptive = this.config.settings.adaptiveStealthEnabled !== false;

		const launchOptions: any = {
			headless: effectiveHeadless,
			args: [
				"--no-sandbox",
				"--disable-setuid-sandbox",
				"--disable-dev-shm-usage",
				// Use new headless mode on macOS to prevent ghost window flicker
				...(effectiveHeadless && process.platform === "darwin" ? ["--headless=new"] : []),
				// ── Anti-detection Chromium flags ──
				// Disable automation-controlled indicators
				"--disable-blink-features=AutomationControlled",
				// Suppress "Chrome is being controlled by automated test software" infobar
				"--disable-infobars",
				// Prevent exclusion switches from being sent to the browser
				"--no-first-run",
				"--no-default-browser-check",
				// Consistent window size for fingerprinting
				"--window-size=1280,720",
			],
			// When using Patchright (adaptive stealth), prefer system Chrome over bundled
			// Chromium. System Chrome has a real TLS fingerprint and browser version (e.g. 147)
			// instead of Patchright's bundled Chromium (e.g. 134) which is instantly flagged
			// by Akamai, Reddit, and other sites with version-based detection.
			...(isAdaptive ? { channel: "chrome" } : {}),
			...extraOptions,
		};

		if (this.config.browser.proxy) {
			launchOptions.proxy = this.config.browser.proxy;
		}

		return launchOptions;
	}

	private async tryLaunchContext(launcher: any, userDataDir: string, launchOptions: any): Promise<BrowserContext> {
		const ctx = (await launcher.launchPersistentContext(userDataDir, launchOptions)) as BrowserContext;
		this.contexts.add(ctx);
		this.attachCloseHandler(ctx);
		return ctx;
	}

	private computeLaunchHash(options: LaunchOptions): string {
		const parts = [
			String(options.headless),
			String(options.browserType),
			options.proxy ? JSON.stringify(options.proxy) : "",
			options.userDataDir ?? "",
		(options.args ?? []).sort((a, b) => a.localeCompare(b)).join(","),
		options.extensions?.sort((a, b) => a.localeCompare(b)).join(",") ?? "",
		];
		return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
	}

	private resolveBrowserType(browserType?: BrowserType): Promise<BrowserType> | BrowserType {
		let actual = browserType || this.config.browser.preferred;
		if (process.platform !== "darwin" && this.config.browser.autoDetect) {
			return this.autoDetectBrowser();
		}
		return actual;
	}

	private async launchWithFallback(
		launcher: any,
		userDataDir: string,
		launchOptions: any,
		browserType: BrowserType,
	): Promise<BrowserContext> {
		try {
			return await this.tryLaunchContext(launcher, userDataDir, launchOptions);
		} catch (error: unknown) {
			if (launchOptions.channel === "chrome") {
				delete launchOptions.channel;
				try {
					return await this.tryLaunchContext(launcher, userDataDir, launchOptions);
				} catch { // NOSONAR -- non-fatal
					throw new Error(`Browser launch failed for ${browserType}. Please ensure Chrome is installed.`);
				}
			}
			const msg = error instanceof Error ? error.message : String(error);
			if (msg.includes("browser")) {
				throw new Error(`Browser launch failed for ${browserType}. Please ensure the browser is installed.`);
			}
			throw error;
		}
	}

	async launch(
		profile: TaloxProfile,
		_headed?: boolean,
		browserType?: BrowserType,
		extraOptions?: any,
	): Promise<BrowserContext> {
		const actualBrowserType = await this.resolveBrowserType(browserType);

		// Use Patchright (stealth driver) when adaptiveStealthEnabled is true (default).
		// Patchright patches CDP Runtime.enable leak, removes --enable-automation flag,
		// and fixes other driver-level detection vectors that JS injection can't reach.
		const isAdaptive = this.config.settings.adaptiveStealthEnabled !== false;
		const launcher = this.resolveLauncher(actualBrowserType, isAdaptive);
		const launchOptions = this.buildLaunchOptions(extraOptions);

		// Compute hash of launch options to detect config changes
		const newHash = this.computeLaunchHash({
			headless: launchOptions.headless,
			browserType: actualBrowserType,
			userDataDir: profile.userDataDir,
			...(this.config.browser.proxy ? { proxy: this.config.browser.proxy } : {}),
			...(launchOptions.args ? { args: launchOptions.args } : {}),
			...(extraOptions?.extensions ? { extensions: extraOptions.extensions } : {}),
		});

		// Reuse existing browser if configuration hasn't changed
		if (this.context && newHash === this.launchOptionsHash) {
			return this.context;
		}

		// Close existing browser if configuration changed
		if (this.context) {
			await this.close();
		}

		this.launchOptionsHash = newHash;

		// Do not force chrome channel, as it conflicts if the user has Chrome open.
		// Use Playwright's bundled Chromium instead.

		this.context = await this.launchWithFallback(launcher, profile.userDataDir, launchOptions, actualBrowserType);
		return this.context;
	}

	async close() {
		if (this.context) {
			await this.context.close();
			this.context = null;
		}
	}

	getContext(): BrowserContext | null {
		return this.context;
	}

	async newPage(): Promise<any> {
		if (!this.context) throw new Error("Browser not launched");
		return this.context.newPage();
	}
}

export function createLiveBootManager(): BrowserManager {
	return new BrowserManager();
}

export function printBrowserInstallGuide(): void {
	console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           Browser Installation Required                           ║
╠══════════════════════════════════════════════════════════════════╣
║  No browsers detected. Install one of:                           ║
║                                                                  ║
║    Chrome (recommended):                                         ║
║    - macOS: https://google.com/chrome                           ║
║    - Linux: sudo apt install google-chrome-stable              ║
║    - Windows: https://google.com/chrome                        ║
║                                                                  ║
║    Or use Playwright to install:                                ║
║    npx playwright install chromium                              ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
  `);
}
