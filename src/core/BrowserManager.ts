import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type BrowserContext,
	chromium,
	firefox,
	type BrowserType as PlaywrightBrowserType,
	webkit,
} from "playwright-core";
import type { TaloxProfile, TaloxSettings } from "../types/index.js";
import { createLogger } from "./Logger.js";

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
		chromiumSandbox: boolean;
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

export type TaloxConfigOverrides = {
	[K in keyof TaloxConfig]?: Partial<TaloxConfig[K]>;
};

export const DEFAULT_CONFIG: TaloxConfig = {
	browser: {
		autoDetect: true,
		preferred: "chromium",
		headless: true,
		chromiumSandbox: false,
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
		actionTimeoutMs: 5000,
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
		virtualDisplay: false,
		contentSafety: "warn",
		networkGuard: "off",
		trustedDomains: [],
	},
};

export function getDefaultConfig(): TaloxConfig {
	const cfg = structuredClone(DEFAULT_CONFIG);
	// TALOX_HEADLESS=false is an emergency escape hatch to force headed mode
	// regardless of mode. Prefer using { headed: true } in launch() options instead.
	if (process.env.TALOX_HEADLESS === "false") {
		cfg.browser.headless = false;
	}
	if (process.env.TALOX_CHROMIUM_SANDBOX === "true") {
		cfg.browser.chromiumSandbox = true;
	} else if (process.env.TALOX_CHROMIUM_SANDBOX === "false") {
		cfg.browser.chromiumSandbox = false;
	}
	return cfg;
}

export function resolveConfigDir(): string {
	return process.cwd();
}

function mergeConfig(base: TaloxConfig, overrides?: TaloxConfigOverrides): TaloxConfig {
	if (!overrides) return base;
	return {
		browser: { ...base.browser, ...overrides.browser },
		profile: { ...base.profile, ...overrides.profile },
		settings: { ...base.settings, ...overrides.settings },
	};
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
	virtualDisplay?: boolean;
	proxy?: { server: string; username?: string; password?: string };
	userDataDir?: string;
	args?: string[];
	extensions?: string[];
}

const processCleanupCallbacks = new Set<() => void>();
let processCleanupHandlersInstalled = false;
const activePersistentProfileDirs = new Set<string>();
const reservedXvfbDisplays = new Set<string>();

function canonicalProfileDir(userDataDir: string): string {
	const resolved = path.resolve(userDataDir);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
const activeXvfbDisplays: Array<{ child: ChildProcess; display: string }> = [];
let baseDisplayEnv: string | undefined;
let baseDisplayEnvCaptured = false;

function activateXvfbDisplay(child: ChildProcess, display: string): void {
	if (activeXvfbDisplays.some((entry) => entry.child === child)) return;
	if (activeXvfbDisplays.length === 0) {
		baseDisplayEnv = process.env.DISPLAY;
		baseDisplayEnvCaptured = true;
	}
	activeXvfbDisplays.push({ child, display });
	process.env.DISPLAY = display;
}

function deactivateXvfbDisplay(child: ChildProcess): void {
	const index = activeXvfbDisplays.findIndex((entry) => entry.child === child);
	if (index < 0) return;
	const wasActiveDisplay = index === activeXvfbDisplays.length - 1;
	activeXvfbDisplays.splice(index, 1);
	if (!wasActiveDisplay) return;

	const previous = activeXvfbDisplays.at(-1);
	if (previous) {
		process.env.DISPLAY = previous.display;
		return;
	}

	if (baseDisplayEnvCaptured && baseDisplayEnv !== undefined) {
		process.env.DISPLAY = baseDisplayEnv;
	} else {
		delete process.env.DISPLAY;
	}
	baseDisplayEnv = undefined;
	baseDisplayEnvCaptured = false;
}

function runProcessCleanupCallbacks(): void {
	const callbacks = Array.from(processCleanupCallbacks);
	processCleanupCallbacks.clear();
	for (const cleanup of callbacks) {
		try {
			cleanup();
		} catch {
			/* NOSONAR — process teardown must continue through other managers */
		}
	}
}

function ensureProcessCleanupHandlers(): void {
	if (processCleanupHandlersInstalled) return;
	processCleanupHandlersInstalled = true;
	process.once("exit", runProcessCleanupCallbacks);
	process.once("SIGINT", () => {
		runProcessCleanupCallbacks();
		process.exit();
	});
}

export class BrowserManager {
	private context: BrowserContext | null = null;
	private config: TaloxConfig;
	private detectedBrowsers: DetectedBrowser[] = [];
	private launchOptionsHash: string | null = null;
	private launchInFlight = false;

	private readonly contexts: Set<BrowserContext> = new Set();
	private readonly processCleanup = () => this.closeAllSync();
	private ownedProfileDir: string | null = null;
	private profileOwnerContext: BrowserContext | null = null;

	// Xvfb virtual display state
	private xvfbProcess: ChildProcess | null = null;
	private xvfbDisplay: string | null = null;

	constructor(config?: TaloxConfigOverrides) {
		this.config = mergeConfig(getDefaultConfig(), config);

		// Auto-enable virtualDisplay on Linux without a real DISPLAY
		if (this.config.settings.virtualDisplay === false && process.platform === "linux" && !process.env.DISPLAY) {
			this.config.settings.virtualDisplay = true;
		}

	}

	private registerProcessCleanup(): void {
		ensureProcessCleanupHandlers();
		processCleanupCallbacks.add(this.processCleanup);
	}

	private unregisterProcessCleanupIfIdle(): void {
		if (this.contexts.size === 0 && this.xvfbProcess === null) {
			processCleanupCallbacks.delete(this.processCleanup);
		}
	}

	private assertPersistentProfileAvailable(userDataDir: string): void {
		const profileDir = canonicalProfileDir(userDataDir);
		if (this.ownedProfileDir !== profileDir && activePersistentProfileDirs.has(profileDir)) {
			throw new Error(`PROFILE_IN_USE: Persistent profile is already active in this process: ${userDataDir}`);
		}
	}

	private claimPersistentProfileOwnership(userDataDir: string): void {
		const profileDir = canonicalProfileDir(userDataDir);
		if (this.ownedProfileDir === profileDir) return;
		if (activePersistentProfileDirs.has(profileDir)) {
			throw new Error(`PROFILE_IN_USE: Persistent profile is already active in this process: ${userDataDir}`);
		}
		activePersistentProfileDirs.add(profileDir);
		this.ownedProfileDir = profileDir;
	}

	private releasePersistentProfileOwnership(): void {
		if (this.ownedProfileDir === null) return;
		activePersistentProfileDirs.delete(this.ownedProfileDir);
		this.ownedProfileDir = null;
		this.profileOwnerContext = null;
	}

	private closeAllSync() {
		// Synchronous cleanup is limited, but we try our best
		for (const ctx of this.contexts) {
			try {
				(ctx as any)._browser?.close().catch(() => {});
			} catch {
				/* NOSONAR */
			}
		}
		this.releasePersistentProfileOwnership();
		this.stopXvfb();
	}

	async closeAll(): Promise<void> {
		const contexts = Array.from(this.contexts);
		const results = await Promise.allSettled(contexts.map((ctx) => ctx.close()));

		for (const [index, result] of results.entries()) {
			if (result.status !== "fulfilled") continue;
			const ctx = contexts[index];
			if (!ctx) continue;
			this.contexts.delete(ctx);
			if (this.context === ctx) this.context = null;
			if (this.profileOwnerContext === ctx) this.releasePersistentProfileOwnership();
		}

		if (this.contexts.size === 0) {
			this.context = null;
			if (this.ownedProfileDir !== null) this.releasePersistentProfileOwnership();
			this.stopXvfb();
		}

		const failedClose = results.find((result) => result.status === "rejected");
		if (failedClose?.status === "rejected") {
			throw failedClose.reason;
		}
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
			} catch {
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
			} catch {
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
				} catch {
					// Try without channel
				}
			} else {
				// Playwright-managed browsers live outside the fixed system paths below.
				// A successful default launch is the most reliable proof that the
				// browser package/cache is actually usable.
				try {
					const browser = await launcher.launch({ timeout: 5000, headless: true });
					const version = browser.version();
					const executablePath = launcher.executablePath();
					await browser.close().catch(() => {});
					return { path: executablePath, version };
				} catch {
					// Fall through to explicit system/cache path probing.
				}
			}

			for (const searchPath of searchPaths) {
				if (fs.existsSync(searchPath)) {
					try {
						const testOptions = { ...options, executablePath: searchPath, headless: true };
						const browser = await launcher.launch(testOptions);
						await browser.close();
						return { path: searchPath, version: undefined };
					} catch {
						/* NOSONAR */
					}
				}
			}

			return null;
		} catch {
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

	updateConfig(config: TaloxConfigOverrides): void {
		this.config = mergeConfig(this.config, config);
	}

	private attachCloseHandler(ctx: BrowserContext): void {
		ctx.on("close", () => {
			this.contexts.delete(ctx);
			if (this.context === ctx) this.context = null;
			if (this.profileOwnerContext === ctx) this.releasePersistentProfileOwnership();
			this.unregisterProcessCleanupIfIdle();
		});
	}

	private async closeContextForRelaunch(preserveProfileOwnership: boolean): Promise<void> {
		const ctx = this.context;
		if (!ctx) return;
		const detachedProfileOwner = preserveProfileOwnership && this.profileOwnerContext === ctx;
		if (detachedProfileOwner) this.profileOwnerContext = null;
		try {
			await ctx.close();
		} catch (error) {
			if (detachedProfileOwner && this.ownedProfileDir !== null && this.profileOwnerContext === null) {
				this.profileOwnerContext = ctx;
			}
			throw error;
		}
		this.contexts.delete(ctx);
		if (this.context === ctx) this.context = null;
		this.unregisterProcessCleanupIfIdle();
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

	private buildLaunchOptions(extraOptions: any, actualBrowserType: BrowserType): any {
		const effectiveHeadless = extraOptions?.headless ?? this.config.browser.headless;
		const isAdaptive = this.config.settings.adaptiveStealthEnabled !== false;
		const chromiumSandbox =
			actualBrowserType === "chromium"
				? (extraOptions?.chromiumSandbox ?? this.config.browser.chromiumSandbox)
				: false;

		const launchOptions: Record<string, unknown> = {
			headless: effectiveHeadless,
			args: [
				...(actualBrowserType === "chromium" && !chromiumSandbox
					? ["--no-sandbox", "--disable-setuid-sandbox"]
					: []),
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
			...(actualBrowserType === "chromium" ? { chromiumSandbox } : {}),
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

	private async tryLaunchContext(
		launcher: PlaywrightBrowserType,
		userDataDir: string,
		launchOptions: Record<string, unknown>,
	): Promise<BrowserContext> {
		const ctx = (await launcher.launchPersistentContext(userDataDir, launchOptions)) as BrowserContext;
		this.contexts.add(ctx);
		this.profileOwnerContext = ctx;
		this.registerProcessCleanup();
		this.attachCloseHandler(ctx);
		return ctx;
	}

	private computeLaunchHash(options: LaunchOptions): string {
		const parts = [
			String(options.headless),
			String(options.browserType),
			String(options.virtualDisplay ?? false),
			options.proxy ? JSON.stringify(options.proxy) : "",
			options.userDataDir ?? "",
			(options.args ?? []).sort((a, b) => a.localeCompare(b)).join(","),
			options.extensions?.sort((a, b) => a.localeCompare(b)).join(",") ?? "",
		];
		return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
	}

	private async resolveBrowserType(browserType?: BrowserType): Promise<BrowserType> {
		// An explicit caller choice is authoritative. launchWithFallback() already
		// reports an actionable install error if the requested browser is unavailable.
		if (browserType) return browserType;
		const actual = this.config.browser.preferred;
		if (process.platform === "darwin" || !this.config.browser.autoDetect) return actual;

		// Probe the requested/preferred browser first. Full auto-detection remains
		// available only when that browser is genuinely unavailable.
		if (this.detectedBrowsers.some((browser) => browser.type === actual)) return actual;
		const executable = await this.findBrowser(actual, undefined, this.getSearchPaths());
		if (executable) {
			this.detectedBrowsers.push({
				type: actual,
				channel: undefined,
				executablePath: executable.path,
				version: executable.version,
			});
			return actual;
		}

		return this.autoDetectBrowser();
	}

	private async launchWithFallback(
		launcher: PlaywrightBrowserType,
		userDataDir: string,
		launchOptions: Record<string, unknown>,
		browserType: BrowserType,
	): Promise<BrowserContext> {
		try {
			return await this.tryLaunchContext(launcher, userDataDir, launchOptions);
		} catch (error: unknown) {
			if (launchOptions.channel === "chrome") {
				delete launchOptions.channel;
				try {
					return await this.tryLaunchContext(launcher, userDataDir, launchOptions);
				} catch {
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

	// ── Xvfb Virtual Display ──────────────────────────────────────────────────────

	/**
	 * Resolve the path to the Xvfb binary. Returns null if not found.
	 */
	private static findXvfb(): string | null {
		const candidates = ["/usr/bin/Xvfb", "/usr/local/bin/Xvfb"];
		for (const candidate of candidates) {
			try {
				fs.accessSync(candidate, fs.constants.X_OK);
				return candidate;
			} catch {
				/* NOSONAR — not found, try next */
			}
		}
		return null;
	}

	/**
	 * Find a free X display number by checking /tmp/.X*-lock files.
	 * Scans from :99 upward and returns the first free number.
	 */
	private static findFreeDisplay(): number {
		for (let display = 99; display < 200; display++) {
			const displayName = `:${display}`;
			if (reservedXvfbDisplays.has(displayName)) continue;
			const lockFile = `/tmp/.X${display}-lock`;
			try {
				fs.accessSync(lockFile, fs.constants.F_OK);
			} catch {
				reservedXvfbDisplays.add(displayName);
				return display;
			}
		}
		throw new Error("No free X display available in the :99-:199 range.");
	}

	/** Release Xvfb state only when the supplied child still owns it. */
	private releaseXvfbOwnership(child: ChildProcess, display: string, terminate: boolean): void {
		// Child events can arrive after a failed start has already been retried.
		// Only the process that still owns the manager state may clear it.
		if (this.xvfbProcess !== child) return;

		if (terminate) {
			try {
				child.kill("SIGTERM");
			} catch {
				/* NOSONAR — process may already be gone */
			}
		}

		this.xvfbProcess = null;
		if (this.xvfbDisplay === display) {
			deactivateXvfbDisplay(child);
			reservedXvfbDisplays.delete(display);
			this.xvfbDisplay = null;
		}
		this.unregisterProcessCleanupIfIdle();
	}

	/**
	 * Start Xvfb and set DISPLAY for headed Chromium on a virtual framebuffer.
	 * @throws Error if Linux/Xvfb prerequisites fail or startup is interrupted.
	 */
	async startXvfb(): Promise<void> {
		if (process.platform !== "linux") {
			throw new Error("Xvfb virtual display is only supported on Linux.");
		}
		if (this.xvfbProcess) {
			return; // already running
		}

		const xvfbPath = BrowserManager.findXvfb();
		if (!xvfbPath) {
			throw new Error("Xvfb not found. Install it with: sudo apt install xvfb");
		}

		const displayNum = BrowserManager.findFreeDisplay();
		const display = `:${displayNum}`;
		this.xvfbDisplay = display;

		let child: ChildProcess;
		try {
			child = spawn(xvfbPath, [display, "-screen", "0", "1280x720x24", "-ac", "-nolisten", "tcp"], {
				stdio: "ignore",
				detached: false,
			});
		} catch (error) {
			reservedXvfbDisplays.delete(display);
			this.xvfbDisplay = null;
			throw new Error(`Failed to start Xvfb: ${error instanceof Error ? error.message : String(error)}`);
		}
		this.xvfbProcess = child;
		this.registerProcessCleanup();

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				resolve();
			}, 500);

			const failStartup = (error: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.releaseXvfbOwnership(child, display, true);
				reject(error);
			};

			child.on("error", (err) => {
				if (!settled) {
					failStartup(new Error(`Failed to start Xvfb: ${err.message}`));
					return;
				}
				this.releaseXvfbOwnership(child, display, false);
			});

			child.on("exit", (code, signal) => {
				if (!settled) {
					const error = code !== null
						? new Error(`Xvfb exited with code ${code}`)
						: new Error(`Xvfb exited before readiness with signal ${signal ?? "unknown"}`);
					failStartup(error);
					return;
				}
				this.releaseXvfbOwnership(child, display, false);
			});
		});

		if (this.xvfbProcess !== child) {
			throw new Error("Xvfb startup was interrupted before readiness.");
		}
		activateXvfbDisplay(child, display);
	}

	/**
	 * Kill the Xvfb process and restore the original DISPLAY environment.
	 */
	stopXvfb(): void {
		const child = this.xvfbProcess;
		const display = this.xvfbDisplay;

		if (child && display) {
			this.releaseXvfbOwnership(child, display, true);
			return;
		}

		if (child) {
			try {
				child.kill("SIGTERM");
			} catch {
				/* NOSONAR — process may have already exited */
			}
			deactivateXvfbDisplay(child);
			this.xvfbProcess = null;
		}
		if (display) {
			reservedXvfbDisplays.delete(display);
			this.xvfbDisplay = null;
		}
		this.unregisterProcessCleanupIfIdle();
	}

	/**
	 * Whether Xvfb is currently running.
	 */
	isXvfbRunning(): boolean {
		return this.xvfbProcess !== null;
	}

	async launch(
		profile: TaloxProfile,
		_headed?: boolean,
		browserType?: BrowserType,
		extraOptions?: any,
	): Promise<BrowserContext> {
		if (this.launchInFlight) {
			throw new Error("LAUNCH_IN_PROGRESS: Browser launch is already in progress for this manager.");
		}
		this.launchInFlight = true;
		try {
		// A duplicate persistent profile is a deterministic local conflict. Reject it
		// before browser discovery or Xvfb startup instead of waiting on Chrome locks.
		this.assertPersistentProfileAvailable(profile.userDataDir);
		const actualBrowserType = await this.resolveBrowserType(browserType);

		// Keep Xvfb ownership aligned with the current configuration. A manager may
		// be reconfigured between launches; once virtualDisplay is disabled, tear
		// down the owned display before building replacement launch options.
		const virtualDisplayEnabled = this.config.settings.virtualDisplay === true;
		if (!virtualDisplayEnabled && this.xvfbProcess) {
			this.stopXvfb();
		}
		if (virtualDisplayEnabled && !this.xvfbProcess) {
			await this.startXvfb();
		}

		// Use Patchright (stealth driver) when adaptiveStealthEnabled is true (default).
		// Patchright patches CDP Runtime.enable leak, removes --enable-automation flag,
		// and fixes other driver-level detection vectors that JS injection can't reach.
		const isAdaptive = this.config.settings.adaptiveStealthEnabled !== false;
		const launcher = this.resolveLauncher(actualBrowserType, isAdaptive);

		// When using Xvfb, force headed mode (headless: false) so Chromium has
		// a real fingerprint. The virtual display makes "headed" possible.
		if (this.xvfbProcess && extraOptions?.headless !== false) {
			extraOptions = { ...extraOptions, headless: false };
		}

		const launchOptions = this.buildLaunchOptions(extraOptions, actualBrowserType);
		if (this.xvfbDisplay) {
			// DISPLAY is process-global, so overlapping managers can change it between
			// Xvfb readiness and Chromium spawn. Pin this browser to the display owned
			// by this manager. Preserve an explicitly supplied launch environment; only
			// inherit the Talox process environment when the caller did not provide one.
			const launchEnv = launchOptions.env as NodeJS.ProcessEnv | undefined;
			launchOptions.env = { ...(launchEnv ?? process.env), DISPLAY: this.xvfbDisplay };
		}

		// Compute hash of launch options to detect config changes
		const newHash = this.computeLaunchHash({
			headless: launchOptions.headless,
			browserType: actualBrowserType,
			virtualDisplay: virtualDisplayEnabled,
			userDataDir: profile.userDataDir,
			...(this.config.browser.proxy ? { proxy: this.config.browser.proxy } : {}),
			...(launchOptions.args ? { args: launchOptions.args } : {}),
			...(extraOptions?.extensions ? { extensions: extraOptions.extensions } : {}),
		});

		// Reuse existing browser if configuration hasn't changed
		if (this.context && newHash === this.launchOptionsHash) {
			return this.context;
		}

		// Close only the browser context when launch configuration changes. Keep an
		// owned Xvfb alive because launchOptions may already be pinned to that display.
		if (this.context) {
			const targetProfileDir = canonicalProfileDir(profile.userDataDir);
			await this.closeContextForRelaunch(this.ownedProfileDir === targetProfileDir);
		}

		try {
			this.claimPersistentProfileOwnership(profile.userDataDir);
		} catch (error) {
			// Another launch may have won the race after the early availability check.
			// An otherwise-idle manager should not keep a freshly-started Xvfb alive.
			if (this.context === null && this.ownedProfileDir === null) this.stopXvfb();
			throw error;
		}
		this.launchOptionsHash = newHash;

		// Do not force chrome channel, as it conflicts if the user has Chrome open.
		// Use Playwright's bundled Chromium instead.
		try {
			this.context = await this.launchWithFallback(launcher, profile.userDataDir, launchOptions, actualBrowserType);
			return this.context;
		} catch (error) {
			this.launchOptionsHash = null;
			this.releasePersistentProfileOwnership();
			throw error;
		}
		} finally {
			this.launchInFlight = false;
		}
	}

	async close() {
		if (this.context) {
			await this.context.close();
			this.context = null;
		}
		this.releasePersistentProfileOwnership();
		this.stopXvfb();
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

const browserLog = createLogger("Browser");
export function printBrowserInstallGuide(): void {
	browserLog.info(`
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
