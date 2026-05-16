/**
 * @file SessionManager.ts
 * @description Session lifecycle, browser launch, multi-page management,
 * and auto-thinking idle behavior for TaloxController.
 */

// ─── Re-exported types ────────────────────────────────────────────────────────
/** Viewport-relative scoping frame for perception and interaction. */
export interface AttentionFrame {
	x: number;
	y: number;
	width: number;
	height: number;
	selector?: string;
}

import type { TaloxEventMap } from "../../types/events.js";
import type { Point, ProfileClass, TaloxPageState, TaloxProfile } from "../../types/index.js";
import type { ObserveSessionOptions } from "../../types/session.js";
import type { TaloxSettings } from "../../types/settings.js";
import { ArtifactBuilder } from "../ArtifactBuilder.js";
import { AutoDialogHandler, type DialogRecord } from "../AutoDialogHandler.js";
import { BrowserManager, type BrowserType } from "../BrowserManager.js";
import { FingerprintGenerator, type FingerprintProfile } from "../FingerprintGenerator.js";
import { ObserveSession } from "../observe/ObserveSession.js";
import { PageStateCollector } from "../PageStateCollector.js";
import { PolicyEngine } from "../PolicyEngine.js";
import { ProfileVault } from "../ProfileVault.js";
import { RulesEngine } from "../RulesEngine.js";
import { captureSessionSnapshot, restoreSessionSnapshot, type SessionSnapshot } from "../SessionSnapshot.js";
import { VisionGate } from "../VisionGate.js";
import type { EventBus } from "./EventBus.js";

/**
 * Orchestrates the full browser session lifecycle: launching browsers (with
 * stealth injection, fingerprint randomization, and behavioral DNA), managing
 * multiple pages/tabs, handling headed/headless mode switching with session
 * snapshot preservation, and driving automatic idle "thinking" behaviors.
 */
export class SessionManager {
	readonly browserManager: BrowserManager;
	readonly profileVault: ProfileVault;
	readonly rulesEngine: RulesEngine;
	readonly artifactBuilder: ArtifactBuilder;
	readonly visionGate: VisionGate;
	readonly policyEngine: PolicyEngine;

	pages: PageStateCollector[] = [];
	activePageIndex: number = -1;
	pageMousePositions: Map<number, Point> = new Map();
	profile: TaloxProfile | null = null;
	lastState: TaloxPageState | null = null;
	isFirstNavigation: boolean = true;

	private observeSession: ObserveSession | null = null;
	private autoThinkingCheckInterval: NodeJS.Timeout | null = null;
	private autoThinkingInterval: NodeJS.Timeout | null = null;
	private lastActivityTimestamp: number = 0;
	private isAutoThinkingActive: boolean = false;

	/** Auto-dialog handler — installed on every new page if enabled in settings. */
	readonly dialogHandler: AutoDialogHandler;

	/** Session idle timeout interval — checks every 30s for inactivity. */
	private sessionIdleCheckInterval: NodeJS.Timeout | null = null;
	/** Tracks the last time any meaningful interaction occurred (for session idle). */
	private sessionLastActivity: number = 0;

	/** Saved before a headed/headless browser restart so the new session can restore it. */
	private pendingSnapshot: SessionSnapshot | null = null;
	/** The current fingerprint profile used for this session. */
	private fingerprint: FingerprintProfile | null = null;
	private readonly fingerprintGen = new FingerprintGenerator();

	constructor(
		private readonly settings: TaloxSettings,
		private readonly events: EventBus<TaloxEventMap>,
		baseDir: string,
	) {
		this.browserManager = new BrowserManager();
		this.profileVault = new ProfileVault(baseDir);
		this.rulesEngine = new RulesEngine();
		this.artifactBuilder = new ArtifactBuilder();
		this.visionGate = new VisionGate();
		this.policyEngine = new PolicyEngine();
		this.dialogHandler = new AutoDialogHandler(events, settings.verbosity);
	}

	// ─── Launch ──────────────────────────────────────────────────────────────────

	/**
	 * Launch a browser session.
	 * Settings determine the behavior (headed, stealth, etc.)
	 */
	async launch(
		profileId: string,
		profileClass: ProfileClass,
		settings: TaloxSettings,
		browserType: BrowserType = "chromium",
		observeOptions?: ObserveSessionOptions,
	): Promise<void> {
		this.profile = await this.profileVault.createProfile(profileId, profileClass, "Agent Session");
		const behavioralDNA = this.generateBehavioralDNA(profileId);

		const resolvedOpts: ObserveSessionOptions = { ...observeOptions };
		const wantsHeaded = resolvedOpts.headed ?? this.settings.headed;

		const launchOptions: any = {};
		if (wantsHeaded) {
			launchOptions.headless = false;
		}

		// Generate a consistent fingerprint profile for this session
		this.fingerprint = this.fingerprintGen.generate(profileId);

		launchOptions.userAgent = this.fingerprint.userAgent;
		launchOptions.viewport = {
			width: this.fingerprint.screen.width,
			height: this.fingerprint.screen.height,
		};

		// Support native video recording
		if ((resolvedOpts as any).recordVideo) {
			launchOptions.recordVideo = (resolvedOpts as any).recordVideo;
		}

		const context = await this.browserManager.launch(this.profile, this.settings.headed, browserType, launchOptions);
		const page = await context.newPage();

		await this.injectStealthScripts(page);

		await this.attachSecurityHooks(page);

		// Install auto-dialog handler if enabled
		if (this.settings.autoDialogHandling) {
			this.dialogHandler.install(page);
		}

		const stateCollector = new PageStateCollector(page);
		this.activePageIndex = 0;
		this.pages = [stateCollector];
		this.pageMousePositions.set(0, { x: 0, y: 0 });
		this.artifactBuilder.addAction("launch", { profileId, profileClass, browserType, launchOptions });

		const needsSession = resolvedOpts.overlay === true || resolvedOpts.record === true;

		if (needsSession) {
			this.observeSession = new ObserveSession(page, context, this.events, this.artifactBuilder, resolvedOpts);
			await this.observeSession.start();
		}

		this.startAutoThinking(behavioralDNA);
		this.startSessionIdleMonitor();
	}

	async stop(): Promise<void> {
		this.stopAutoThinking();
		this.stopSessionIdleMonitor();
		this.dialogHandler.dispose();
		await this.browserManager.close();

		if (this.observeSession) {
			await this.observeSession.endSession();
			this.observeSession = null;
		}
	}

	// ─── Headed Mode Escalation ───────────────────────────────────────────────────

	/**
	 * Switch between headless and headed mode with full session preservation.
	 *
	 * Flow:
	 * 1. Capture cookies, localStorage, sessionStorage, URL, and scroll position
	 *    from the current page before the browser is closed.
	 * 2. Close the current browser context.
	 * 3. Relaunch with the new `headed` setting (using the same profile).
	 * 4. Restore the captured session snapshot onto the fresh page.
	 *
	 * Observe-mode bypass: if `this.settings.observeBypass` is true the escalation
	 * is skipped (handled by AdaptationEngine before this point).
	 */
	async setHeadedMode(headed: boolean): Promise<void> {
		const context = this.browserManager.getContext();
		const page = this.getPage();
		const profile = this.profile;

		// Nothing to do if browser isn't running or headed state is unchanged
		if (!context || !page || !profile) return;
		if (this.settings.headed === headed) return;

		// 1. Capture session before teardown
		let snapshot: SessionSnapshot | null = null;
		try {
			snapshot = await captureSessionSnapshot(page, context);
			this.pendingSnapshot = snapshot;
		} catch {
			// Ignored: snapshot capture failed, browser will restart with empty state
		}

		this.artifactBuilder.addAction("headedModeChange", {
			from: this.settings.headed ? "headed" : "headless",
			to: headed ? "headed" : "headless",
			url: snapshot?.url ?? "unknown",
			timestamp: new Date().toISOString(),
		});

		// 2. Close the current browser
		this.stopAutoThinking();
		await this.browserManager.close();
		this.pages = [];
		this.activePageIndex = -1;

		// 3. Update the settings reference (shared object — mutation propagates)
		(this.settings as any).headed = headed;

		// 4. Relaunch with new headed setting
		const launchOptions: any = { headless: !headed };
		if (this.fingerprint) launchOptions.userAgent = this.fingerprint.userAgent;

		const newContext = await this.browserManager.launch(profile, headed, "chromium", launchOptions);
		const newPage = await newContext.newPage();

		await this.injectStealthScripts(newPage);
		await this.attachSecurityHooks(newPage);

		// Re-install auto-dialog handler on new page
		if (this.settings.autoDialogHandling) {
			this.dialogHandler.install(newPage);
		}

		const stateCollector = new PageStateCollector(newPage);
		this.activePageIndex = 0;
		this.pages = [stateCollector];
		this.pageMousePositions.set(0, { x: 0, y: 0 });

		// 5. Restore session snapshot
		if (snapshot) {
			try {
				await restoreSessionSnapshot(newPage, newContext, snapshot);
				this.pendingSnapshot = null;
			} catch (e) {
				// Ignored: snapshot restore failed, agent will see a fresh page
				if (snapshot?.url) {
					await newPage.goto(snapshot.url).catch(() => {});
				}
			}
		}

		const behavioralDNA = this.generateBehavioralDNA(profile.id);
		this.startAutoThinking(behavioralDNA);
		this.startSessionIdleMonitor();
	}

	// ─── Freeze/Unfreeze for Human Takeover ───────────────────────────────────────

	private isFrozen: boolean = false;

	freeze(): void {
		this.isFrozen = true;
		this.stopAutoThinking();
		this.artifactBuilder.addAction("freeze", { timestamp: new Date().toISOString() });
	}

	unfreeze(): void {
		this.isFrozen = false;
		this.artifactBuilder.addAction("unfreeze", { timestamp: new Date().toISOString() });
	}

	// ─── Multi-Page ──────────────────────────────────────────────────────────────

	async openPage(url: string): Promise<TaloxPageState> {
		const page = await this.browserManager.newPage();

		await this.injectStealthScripts(page);

		await this.attachSecurityHooks(page);

		// Install auto-dialog handler on new page
		if (this.settings.autoDialogHandling) {
			this.dialogHandler.install(page);
		}

		const stateCollector = new PageStateCollector(page);
		this.activePageIndex = this.pages.length;
		this.pages.push(stateCollector);
		this.pageMousePositions.set(this.activePageIndex, { x: 0, y: 0 });
		this.artifactBuilder.addAction("openPage", { url, pageIndex: this.activePageIndex });

		await page.goto(url);

		const state = await stateCollector.collect();
		state.bugs.push(...this.rulesEngine.analyze(state));
		this.lastState = state;
		return state;
	}

	async closePage(index: number): Promise<void> {
		if (index < 0 || index >= this.pages.length) {
			throw new Error(`Invalid page index: ${index}`);
		}

		const page = (this.pages[index] as any).page;
		await page.close();

		this.pages.splice(index, 1);
		this.pageMousePositions.delete(index);

		if (this.activePageIndex === index) {
			this.activePageIndex = this.pages.length > 0 ? 0 : -1;
		} else if (this.activePageIndex > index) {
			this.activePageIndex--;
		}

		this.artifactBuilder.addAction("closePage", { index });
	}

	switchPage(index: number): void {
		if (index < 0 || index >= this.pages.length) {
			throw new Error(`Invalid page index: ${index}`);
		}
		this.activePageIndex = index;
		this.artifactBuilder.addAction("switchPage", { index });
	}

	getPageCount(): number {
		return this.pages.length;
	}

	getActivePageIndex(): number {
		return this.activePageIndex;
	}

	getActivePage(): PageStateCollector | null {
		if (this.activePageIndex < 0 || this.activePageIndex >= this.pages.length) {
			return null;
		}
		return this.pages[this.activePageIndex] ?? null;
	}

	getPlaywrightPage(): any {
		const collector = this.getActivePage();
		if (!collector) return null;
		return (collector as any).page;
	}

	getAllPages(): PageStateCollector[] {
		return [...this.pages];
	}

	getPage(): any {
		if (this.activePageIndex < 0 || this.activePageIndex >= this.pages.length) {
			throw new Error("No active page. Use launch() or openPage() first.");
		}
		return (this.pages[this.activePageIndex] as any).page;
	}

	getActiveStateCollector(): PageStateCollector {
		const page = this.pages[this.activePageIndex];
		if (!page) {
			throw new Error("No active page. Use launch() or openPage() first.");
		}
		return page;
	}

	// ─── Visual Verification ─────────────────────────────────────────────────────

	async verifyVisual(baselineKey: string, autoSave: boolean = false): Promise<any> {
		const page = this.getPage();
		const screenshot = await page.screenshot();

		const baseline = await this.visionGate.getBaseline(baselineKey);

		if (!baseline) {
			if (autoSave) {
				await this.visionGate.saveBaseline(baselineKey, screenshot);
				return { mismatchedPixels: 0, ssimScore: 1, isMatch: true };
			}
			throw new Error(`Baseline '${baselineKey}' not found and autoSave is false.`);
		}

		const diff = await this.visionGate.compare(baseline, screenshot);
		const ocrText = await this.visionGate.extractText(screenshot);

		return {
			...diff,
			ocrText,
			isMatch: diff.mismatchedPixels < 50 && diff.ssimScore > 0.98,
		};
	}

	// ─── Auto-Thinking ───────────────────────────────────────────────────────────

	startAutoThinking(behavioralDNA: any): void {
		const settings = this.settings;

		if (!settings.automaticThinkingEnabled) {
			this.artifactBuilder.addAction("startAutoThinking", { reason: "disabled" });
			return;
		}

		if (this.isAutoThinkingActive) {
			return;
		}

		this.isAutoThinkingActive = true;
		this.lastActivityTimestamp = Date.now();

		this.autoThinkingCheckInterval = setInterval(() => {
			const lastPos = this.getCurrentMousePos();
			const attentionFrame = null; // resolved externally when needed
			this.checkIdleAndThink(lastPos, attentionFrame, (x, y) => ({ x, y })).catch(() => {
				// Auto-thinking failures are non-fatal — suppress to avoid crashing the process
			});
		}, 1000);

		this.artifactBuilder.addAction("startAutoThinking", {
			idleTimeout: settings.idleTimeout,
			mode: "smart",
		});
	}

	stopAutoThinking(): void {
		if (!this.isAutoThinkingActive) {
			return;
		}

		if (this.autoThinkingCheckInterval) {
			clearInterval(this.autoThinkingCheckInterval);
			this.autoThinkingCheckInterval = null;
		}

		if (this.autoThinkingInterval) {
			clearTimeout(this.autoThinkingInterval);
			this.autoThinkingInterval = null;
		}

		this.isAutoThinkingActive = false;
		this.artifactBuilder.addAction("stopAutoThinking", {});
	}

	isAutoThinkingRunning(): boolean {
		return this.isAutoThinkingActive;
	}

	setAutomaticThinkingEnabled(enabled: boolean): void {
		this.settings.automaticThinkingEnabled = enabled;
		this.artifactBuilder.addAction("setAutomaticThinkingEnabled", { enabled });
	}

	setIdleTimeout(timeoutMs: number): void {
		const clamped = Math.max(1000, Math.min(60000, timeoutMs));
		this.settings.idleTimeout = clamped;
		this.artifactBuilder.addAction("setIdleTimeout", { idleTimeout: clamped });
	}

	// ─── Session Idle Timeout ──────────────────────────────────────────────────

	/**
	 * Start the session idle timeout monitor.
	 * Checks every 30 seconds whether the session has been idle beyond
	 * `sessionIdleTimeoutMs`. If so, emits `sessionIdle` and optionally
	 * closes the browser.
	 */
	startSessionIdleMonitor(): void {
		this.stopSessionIdleMonitor();
		this.sessionLastActivity = Date.now();

		const IDLE_CHECK_INTERVAL_MS = 30_000;

		this.sessionIdleCheckInterval = setInterval(() => {
			const idleMs = Date.now() - this.sessionLastActivity;
			if (idleMs >= this.settings.sessionIdleTimeoutMs) {
				const sessionId = this.profile?.id ?? "unknown";
				this.events.emit("sessionIdle", {
					idleMs,
					timeoutMs: this.settings.sessionIdleTimeoutMs,
					sessionId,
				});

				if (this.settings.verbosity > 0) {
					console.log(
						`[SessionIdle] Session "${sessionId}" idle for ${idleMs}ms (timeout: ${this.settings.sessionIdleTimeoutMs}ms)`,
					);
				}

				// If no human takeover configured, close the browser gracefully
				if (!this.settings.humanTakeoverEnabled) {
					this.stop().catch(() => {
						// NOSONAR — best-effort close
					});
				}
			}
		}, IDLE_CHECK_INTERVAL_MS);

		this.artifactBuilder.addAction("startSessionIdleMonitor", {
			sessionIdleTimeoutMs: this.settings.sessionIdleTimeoutMs,
		});
	}

	/**
	 * Stop the session idle timeout monitor.
	 */
	stopSessionIdleMonitor(): void {
		if (this.sessionIdleCheckInterval) {
			clearInterval(this.sessionIdleCheckInterval);
			this.sessionIdleCheckInterval = null;
		}
	}

	async triggerThinkingBehavior(
		lastMousePos: Point,
		attentionFrame: any,
		clampToFrame: (x: number, y: number) => Point,
	): Promise<void> {
		const settings = this.settings;
		if (!settings.automaticThinkingEnabled) {
			return;
		}

		const behaviorType = Math.random();

		if (behaviorType < 0.4) {
			await this.performMicroJitter(this.getPage(), lastMousePos, (p) => {
				/* caller updates */
			});
		} else if (behaviorType < 0.7) {
			await this.performSmallCursorMovement(this.getPage(), lastMousePos, attentionFrame, clampToFrame, (p) => {
				/* caller updates */
			});
		} else {
			await this.performMicroScroll(this.getPage());
		}

		this.lastActivityTimestamp = Date.now();
		this.artifactBuilder.addAction("triggerThinkingBehavior", { behaviorType });
	}

	recordActivity(): void {
		this.lastActivityTimestamp = Date.now();
		this.sessionLastActivity = Date.now();
	}

	// ─── Private: Auto-Think Helpers ─────────────────────────────────────────────

	private async checkIdleAndThink(
		lastMousePos: Point,
		attentionFrame: any,
		clampToFrame: (x: number, y: number) => Point,
	): Promise<void> {
		const settings = this.settings;
		if (!this.isAutoThinkingActive || !settings.automaticThinkingEnabled) {
			return;
		}

		const idleTime = Date.now() - this.lastActivityTimestamp;
		if (idleTime >= settings.idleTimeout) {
			await this.triggerThinkingBehavior(lastMousePos, attentionFrame, clampToFrame);
		}
	}

	async performMicroJitter(page: any, lastMousePos: Point, setLastMousePos: (p: Point) => void): Promise<void> {
		const jitterAmount = 2 + Math.random() * 5;
		const angle = Math.random() * 2 * Math.PI;
		const offsetX = Math.round(Math.cos(angle) * jitterAmount);
		const offsetY = Math.round(Math.sin(angle) * jitterAmount);

		const newX = lastMousePos.x + offsetX;
		const newY = lastMousePos.y + offsetY;

		await page.mouse.move(newX, newY);
		setLastMousePos({ x: newX, y: newY });
	}

	async performSmallCursorMovement(
		page: any,
		lastMousePos: Point,
		attentionFrame: any,
		clampToFrame: (x: number, y: number) => Point,
		setLastMousePos: (p: Point) => void,
	): Promise<void> {
		const movementRange = 20 + Math.random() * 40;
		const angle = Math.random() * 2 * Math.PI;
		const offsetX = Math.round(Math.cos(angle) * movementRange);
		const offsetY = Math.round(Math.sin(angle) * movementRange);

		const clampedPos = attentionFrame
			? clampToFrame(lastMousePos.x + offsetX, lastMousePos.y + offsetY)
			: { x: lastMousePos.x + offsetX, y: lastMousePos.y + offsetY };

		await page.mouse.move(clampedPos.x, clampedPos.y, { steps: 2 });
		setLastMousePos(clampedPos);
	}

	async performMicroScroll(page: any): Promise<void> {
		const scrollAmount = 50 + Math.random() * 100;
		const scrollDirection = Math.random() > 0.5 ? -1 : 1;
		await page.mouse.wheel(0, scrollDirection * scrollAmount);
	}

	// ─── Private: Security ────────────────────────────────────────────────────────

	private async attachSecurityHooks(page: any): Promise<void> {
		if (!this.profile || this.profile.class === "sandbox") return;

		// 1. Outbound Request Guard
		await page.route("**/*", (route: any) => {
			const request = route.request();
			const method = request.method();
			const url = request.url();

			if ((method === "POST" || method === "PUT") && this.profile?.class === "ops") {
				const postData = request.postData() || "";
				// Match JWT tokens (eyJ...), API keys, bearer tokens, and common secret patterns
				const jwtRegex = /(eyJ[\w-]{10,}\.[\w-]{10,})/i;
				const secretKeyRegex = /(?:api[_-]?key|secret|token|password|bearer)\s*[:=]\s*['"]?[\w-]{8,}/i;

				if (
					jwtRegex.test(postData) ||
					secretKeyRegex.test(postData) ||
					jwtRegex.test(url) ||
					secretKeyRegex.test(url)
				) {
					console.error(`🛡️ SECURITY GUARD BLOCKED REQUEST: Potential credential leak to ${url}`);
					return route.abort("accessdenied");
				}
			}
			route.continue();
		});

		// 2. Per-Tab Behavior Monitoring (Popup Storms / Dialogs)
		let dialogCount = 0;
		page.on("dialog", async (dialog: any) => {
			dialogCount++;
			if (dialogCount > 3 && this.profile?.class === "ops") {
				console.warn("🛡️ SECURITY GUARD: Unexpected dialog storm detected. Auto-dismissing.");
				await dialog.dismiss();
			} else {
				await dialog.dismiss();
			}
		});

		page.on("popup", (popup: any) => {
			console.warn(`🛡️ SECURITY GUARD: Unexpected popup opened: ${popup.url()}`);
			if (this.profile?.class === "ops") {
				popup.close().catch(() => {});
			}
		});

		// 3. Runtime Script Analysis (Heuristic-based)
		if (this.profile?.class === "ops") {
			page.on("response", async (response: any) => {
				const url = response.url();
				const type = response.request().resourceType();
				if (type === "script" || type === "fetch" || type === "xhr") {
					if (url.includes("exfil") || url.includes("tracker") || url.includes("fingerprint")) {
						console.warn(`🛡️ SECURITY GUARD: Suspicious script loaded: ${url}`);
					}
				}
			});
		}
	}

	async injectStealthScripts(page: any): Promise<void> {
		// Generate a fingerprint if one doesn't exist yet (e.g. in tests)
		this.fingerprint ??= this.fingerprintGen.generate();

		const fp = this.fingerprint;

		// Serialize the fingerprint profile for injection into the page.
		// All values are pre-validated for consistency by FingerprintGenerator.
		const stealthData = {
			vendor: fp.webgl.vendor,
			renderer: fp.webgl.renderer,
			platform: fp.platform,
			languages: fp.languages,
			hardwareConcurrency: fp.hardwareConcurrency,
			deviceMemory: fp.deviceMemory,
			timezone: fp.timezone,
			locale: fp.locale,
			audioSampleRate: fp.audio.sampleRate,
			audioMaxChannelCount: fp.audio.maxChannelCount,
			audioOutputLatency: fp.audio.outputLatency,
			fontLetterSpacingMin: fp.fonts.letterSpacingOffsetRange[0],
			fontLetterSpacingMax: fp.fonts.letterSpacingOffsetRange[1],
			battery: fp.battery,
		};

		await page.addInitScript((data: any) => {
			// 1. Navigator Webdriver Evasion — the property must not exist at all.
			// Detection libraries check `navigator.webdriver` (returns false) AND
			// `'webdriver' in navigator` (returns true if property exists).
			// We must delete the property from Navigator.prototype entirely.
			// Patchright handles this at the driver level, but belt-and-suspenders.
			try {
				delete (Navigator.prototype as any).webdriver;
			} catch (_e) {
				/* NOSONAR — some contexts lock this */
			}
			// If delete failed (non-configurable), override via prototype chain
			if ("webdriver" in navigator) {
				try {
					Object.defineProperty(Object.getPrototypeOf(navigator), "webdriver", {
						get: () => undefined,
						configurable: true,
					});
				} catch (_e) {
					/* Ignored: non-fatal browser API error */
				}
			}

			// 2. Chrome Runtime Spoofing
			// @ts-expect-error
			if (!globalThis.chrome?.runtime) {
				// @ts-expect-error
				globalThis.chrome = {
					runtime: {
						onMessage: { addListener: () => {}, removeListener: () => {} },
						onConnect: { addListener: () => {}, removeListener: () => {} },
						sendMessage: () => {},
						connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
					},
					loadTimes: () => ({ firstPaintTime: 0, startLoadTime: 0, commitLoadTime: 0 }),
					csi: () => ({ onloadT: 0, startE: 0, pageT: 0 }),
					app: {
						isInstalled: false,
						InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
						RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
						getDetails: () => null,
						getIsInstalled: () => false,
						installState: () => "not_installed",
					},
				};
			}

			// 3. Plugin Spoofing — use real PluginArray interface via Object.create
			// to pass `instanceof PluginArray` checks
			const fakePluginData = [
				{
					name: "PDF Viewer",
					filename: "internal-pdf-viewer",
					description: "Portable Document Format",
					length: 1,
					0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
				},
				{
					name: "Chrome PDF Viewer",
					filename: "internal-pdf-viewer",
					description: "Google Chrome PDF Viewer",
					length: 1,
					0: { type: "application/pdf", suffixes: "pdf", description: "Google Chrome PDF Viewer" },
				},
				{
					name: "Chromium PDF Viewer",
					filename: "internal-pdf-viewer",
					description: "Chromium PDF Viewer",
					length: 1,
					0: { type: "application/pdf", suffixes: "pdf", description: "Chromium PDF Viewer" },
				},
				{
					name: "Microsoft Edge PDF Viewer",
					filename: "internal-pdf-viewer",
					description: "Microsoft Edge PDF Viewer",
					length: 1,
					0: { type: "application/pdf", suffixes: "pdf", description: "Microsoft Edge PDF Viewer" },
				},
				{
					name: "WebKit built-in PDF",
					filename: "internal-pdf-viewer",
					description: "WebKit built-in PDF Viewer",
					length: 1,
					0: { type: "application/pdf", suffixes: "pdf", description: "WebKit built-in PDF Viewer" },
				},
			];

			// Create a proper PluginArray-like object that passes type checks
			try {
				const realPlugins = navigator.plugins;
				// If real PluginArray exists (even empty), use its prototype for instanceof checks
				if (realPlugins && Object.getPrototypeOf(realPlugins)) {
					const proto = Object.getPrototypeOf(realPlugins);
					const fakeArray = Object.create(proto);
					fakePluginData.forEach((plugin, i) => {
						const p = Object.create(Object.getPrototypeOf(realPlugins[0] || {}));
						Object.defineProperties(p, {
							name: { get: () => plugin.name, enumerable: true },
							filename: { get: () => plugin.filename, enumerable: true },
							description: { get: () => plugin.description, enumerable: true },
							length: { get: () => plugin.length, enumerable: true },
						});
						Object.defineProperty(fakeArray, i, { get: () => p, enumerable: true });
					});
					Object.defineProperty(fakeArray, "length", { get: () => fakePluginData.length });
					Object.defineProperty(navigator, "plugins", {
						get: () => fakeArray,
						configurable: true,
					});
				} else {
					// Fallback: plain array with PluginArray-like methods
					const arr: any = fakePluginData;
					arr.item = (i: number) => arr[i];
					arr.namedItem = (name: string) => arr.find((p: any) => p.name === name);
					arr.refresh = () => {};
					Object.defineProperty(navigator, "plugins", {
						get: () => arr,
						configurable: true,
					});
				}
			} catch (_e) {
				/* Ignored: non-fatal browser API error */
			}

			// 4. Language Spoofing (from fingerprint profile)
			Object.defineProperty(navigator, "languages", {
				get: () => data.languages,
			});

			// 5. Platform Spoofing (consistent with UA)
			Object.defineProperty(navigator, "platform", {
				get: () => data.platform,
			});

			// 6. Hardware Spoofing (consistent with OS)
			Object.defineProperty(navigator, "hardwareConcurrency", {
				get: () => data.hardwareConcurrency,
			});
			Object.defineProperty(navigator, "deviceMemory", {
				get: () => data.deviceMemory,
			});

			// 7. Canvas Fingerprint Protection (subtle noise)
			const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
			HTMLCanvasElement.prototype.toDataURL = function (type, encoderOptions) {
				const context = this.getContext("2d");
				if (context) {
					try {
						const imageData = context.getImageData(0, 0, this.width, this.height);
						if (imageData?.data && imageData.data.length > 0) {
							const lastIdx = imageData.data.length - 1;
							const val = imageData.data[lastIdx];
							if (val !== undefined) {
								imageData.data[lastIdx] = (val + 1) % 255;
								context.putImageData(imageData, 0, 0);
							}
						}
					} catch (e) {
						// NOSONAR
						// Ignore canvas errors
					}
				}
				return originalToDataURL.apply(this, [type, encoderOptions]);
			};

			// 8. WebGL Vendor/Renderer Spoofing (consistent with OS)
			const getParameter = WebGLRenderingContext.prototype.getParameter;
			WebGLRenderingContext.prototype.getParameter = function (parameter) {
				// UNMASKED_VENDOR_WEBGL
				if (parameter === 37445) return data.vendor;
				// UNMASKED_RENDERER_WEBGL
				if (parameter === 37446) return data.renderer;
				return getParameter.apply(this, [parameter]);
			};

			const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
			WebGL2RenderingContext.prototype.getParameter = function (parameter) {
				if (parameter === 37445) return data.vendor;
				if (parameter === 37446) return data.renderer;
				return getParameter2.apply(this, [parameter]);
			};

			// 9. AudioContext Spoofing (consistent with OS)
			if (typeof AudioContext !== "undefined") {
				const OrigAudioContext = AudioContext;
				// @ts-expect-error
				globalThis.AudioContext = (opts: any) => {
					const ctx = new OrigAudioContext(opts);
					Object.defineProperty(ctx, "sampleRate", { get: () => data.audioSampleRate });
					Object.defineProperty(ctx, "maxChannelCount", { get: () => data.audioMaxChannelCount });
					Object.defineProperty(ctx, "outputLatency", { get: () => data.audioOutputLatency });
					return ctx;
				};
			}

			// 10. Battery API Spoofing
			// @ts-expect-error — browser context, getBattery exists at runtime
			if (typeof navigator.getBattery === "function") {
				// @ts-expect-error
				navigator.getBattery = async () => ({
					charging: data.battery.charging,
					chargingTime: data.battery.chargingTime,
					dischargingTime: data.battery.dischargingTime,
					level: data.battery.level,
					addEventListener: () => {},
					removeEventListener: () => {},
					dispatchEvent: () => true,
				});
			}

			// 11. WebRTC Leak Prevention
			if (typeof RTCPeerConnection !== "undefined") {
				const OrigRTCPeerConnection = RTCPeerConnection;
				// @ts-expect-error
				globalThis.RTCPeerConnection = (config: any, constraints: any) => {
					// Force ICE candidate filtering to prevent local IP leaks
					const filteredConfig = {
						...config,
						iceServers: config?.iceServers || [],
					};
					// @ts-expect-error
					return new OrigRTCPeerConnection(filteredConfig, constraints);
				};
			}

			// 12. Font Metrics Fingerprint Defense
			// Offset letter-spacing subtly on measured elements
			if (typeof document !== "undefined") {
				const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
				CanvasRenderingContext2D.prototype.measureText = function (text: string) {
					const result = origMeasureText.apply(this, [text]);
					// Add subtle random offset to defeat font metric fingerprinting
					const offset =
						data.fontLetterSpacingMin + Math.random() * (data.fontLetterSpacingMax - data.fontLetterSpacingMin);
					return {
						...result,
						width: result.width + offset,
					};
				};
			}

			// 13. Timezone Consistency
			if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
				const OrigDateTimeFormat = Intl.DateTimeFormat;
				// @ts-expect-error
				Intl.DateTimeFormat = (locales: any, opts: any) => new OrigDateTimeFormat(data.locale, opts);
				// @ts-expect-error
				Intl.DateTimeFormat.prototype = OrigDateTimeFormat.prototype;
				Intl.DateTimeFormat.supportedLocalesOf = OrigDateTimeFormat.supportedLocalesOf;
			}

			// 14. Permissions API — override to prevent detection via permission state
			if (navigator.permissions?.query) {
				const origQuery = navigator.permissions.query.bind(navigator.permissions);
				navigator.permissions.query = (params: any) => {
					if (params.name === "notifications") {
						return Promise.resolve({ state: "prompt" } as PermissionStatus);
					}
					return origQuery(params);
				};
			}

			// 15. toString leak protection — prevent detection of patched getters
			// Many bot detectors check: Object.getOwnPropertyDescriptor(navigator, 'webdriver').get.toString()
			// If it returns "function get webdriver() { ... }" instead of native code, it's detected.
			const nativeToString = Function.prototype.toString;
			const patchedFunctions = new Map<any, string>();

			// Pre-register our patched functions with native-looking toString
			const fakeNativeToString = function (this: any) {
				if (patchedFunctions.has(this)) {
					return patchedFunctions.get(this)!;
				}
				return nativeToString.call(this);
			};
			patchedFunctions.set(fakeNativeToString, "function toString() { [native code] }");

			// Wrap Function.prototype.toString itself
			const origProtoToString = Function.prototype.toString;
			Function.prototype.toString = function (this: any) {
				if (patchedFunctions.has(this)) {
					return patchedFunctions.get(this)!;
				}
				return origProtoToString.call(this);
			};

			// Register all our patched getters as native
			const nativeGetterStr = "function get webdriver() { [native code] }";
			const nativePluginsStr = "function get plugins() { [native code] }";
			const nativeLangStr = "function get languages() { [native code] }";
			const nativePlatformStr = "function get platform() { [native code] }";
			const nativeHwStr = "function get hardwareConcurrency() { [native code] }";
			const nativeMemStr = "function get deviceMemory() { [native code] }";

			try {
				const wdDesc = Object.getOwnPropertyDescriptor(navigator, "webdriver");
				if (wdDesc?.get) patchedFunctions.set(wdDesc.get, nativeGetterStr);
				const plDesc = Object.getOwnPropertyDescriptor(navigator, "plugins");
				if (plDesc?.get) patchedFunctions.set(plDesc.get, nativePluginsStr);
				const laDesc = Object.getOwnPropertyDescriptor(navigator, "languages");
				if (laDesc?.get) patchedFunctions.set(laDesc.get, nativeLangStr);
				const pfDesc = Object.getOwnPropertyDescriptor(navigator, "platform");
				if (pfDesc?.get) patchedFunctions.set(pfDesc.get, nativePlatformStr);
				const hcDesc = Object.getOwnPropertyDescriptor(navigator, "hardwareConcurrency");
				if (hcDesc?.get) patchedFunctions.set(hcDesc.get, nativeHwStr);
				const dmDesc = Object.getOwnPropertyDescriptor(navigator, "deviceMemory");
				if (dmDesc?.get) patchedFunctions.set(dmDesc.get, nativeMemStr);
			} catch (_e) {
				/* Ignored: non-fatal browser API error */
			}

			// 16. iframe contentWindow detection — prevent cross-origin iframe checks
			// Some detectors create an iframe and check contentWindow.chrome vs window.chrome
			if (typeof document !== "undefined") {
				const origCreateElement = document.createElement.bind(document);
				document.createElement = (tag: string) => {
					const el = origCreateElement(tag);
					if (tag.toLowerCase() === "iframe") {
						// Ensure the iframe's contentWindow inherits our chrome object
						try {
							Object.defineProperty(el, "contentWindow", {
								get: () => null,
							});
						} catch (_e) {
							/* NOSONAR — some browsers don't allow this */
						}
					}
					return el;
				};
				// Register createElement toString as native
				patchedFunctions.set(document.createElement, "function createElement() { [native code] }");
			}

			// 17. Navigator.connection spoofing — consistent with fingerprint profile
			const navConn = (navigator as any).connection;
			if (navConn) {
				try {
					Object.defineProperty(navConn, "rtt", { get: () => 50 });
					Object.defineProperty(navConn, "downlink", { get: () => 10 });
					Object.defineProperty(navConn, "effectiveType", { get: () => "4g" });
					Object.defineProperty(navConn, "saveData", { get: () => false });
				} catch (_e) {
					/* Ignored: non-fatal browser API error */
				}
			}

			// 18. Screen dimensions consistency — prevent screen size vs window size mismatches
			if (typeof window !== "undefined" && window.screen) {
				try {
					Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
					Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
				} catch (_e) {
					/* Ignored: non-fatal browser API error */
				}
			}

			// 19. CDP (Chrome DevTools Protocol) leak protection
			// Patchright handles most CDP leaks, but belt-and-suspenders for any JS-level checks
			if (typeof window !== "undefined") {
				// Delete automation-specific properties that leak through CDP
				try {
					delete (window as any).__playwright;
					delete (window as any).__pw_manual;
					delete (window as any).__PW_inspect;
				} catch (_e) {
					/* Ignored: non-fatal browser API error */
				}
			}
		}, stealthData);
	}

	// ─── Behavioral DNA ───────────────────────────────────────────────────────────

	generateBehavioralDNA(profileId: string): any {
		const hash = this.hashString(profileId);
		const normalizedHash = hash / 0xffffffff;

		const movementStyles = ["smooth", "jerky", "precise", "relaxed"] as const;
		const typingRhythms = ["fast", "medium", "slow", "variable"] as const;
		const accelerationCurves = ["linear", "ease-out", "ease-in-out", "bezier"] as const;

		const dna = {
			jitterFrequency: 0.1 + normalizedHash * 0.9,
			accelerationCurve:
				accelerationCurves[Math.floor(normalizedHash * accelerationCurves.length) % accelerationCurves.length],
			typingRhythm: typingRhythms[Math.floor((normalizedHash * 10) % typingRhythms.length) % typingRhythms.length],
			clickPrecision: 0.5 + normalizedHash * 0.5,
			movementStyle: movementStyles[Math.floor(normalizedHash * movementStyles.length) % movementStyles.length],
		};

		this.artifactBuilder.addAction("generateBehavioralDNA", { profileId, dna });
		return dna;
	}

	private hashString(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.codePointAt(i)!;
			hash = (hash << 5) - hash + char;
			hash = hash & hash;
		}
		return Math.abs(hash);
	}

	// ─── Internal Helpers ─────────────────────────────────────────────────────────

	/** Returns the current mouse position for the active page (used by auto-thinking interval). */
	private getCurrentMousePos(): Point {
		return this.pageMousePositions.get(this.activePageIndex) || { x: 0, y: 0 };
	}
}
