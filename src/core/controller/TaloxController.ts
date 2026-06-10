/**
 * @file TaloxController.ts
 * @description Thin public API orchestrator for Talox v2.
 *
 * `TaloxController` is the single entry point agents and developers interact with.
 * It owns no logic — it delegates entirely to focused sub-classes:
 *
 * | Sub-class        | Responsibility                                       |
 * |------------------|------------------------------------------------------|
 * | `EventBus`       | Typed event emission and subscription                |
 * | `ActionExecutor` | Browser interactions (click, type, navigate, etc.)   |
 * | `SessionManager` | Browser lifecycle, multi-page, auto-thinking         |
 *
 * And two feature modules:
 *
 * | Module            | Responsibility                                      |
 * |-------------------|-----------------------------------------------------|
 * | `AdaptationEngine`| Smart mode self-healing outcome loop                |
 * | `ObserveSession`  | Human-driven sessions with annotation capture       |
 *
 * @example
 * ```ts
 * import { TaloxController } from 'talox';
 *
 * const talox = new TaloxController('./profiles', { verbosity: 1 });
 *
 * talox.on('adapted', (e) => console.log(`Smart mode adapted: ${e.reason}`));
 *
 * await talox.launch('my-agent', 'ops');
 * await talox.navigate('https://example.com');
 * const state = await talox.click('#submit-button');
 * await talox.stop();
 * ```
 */

import type { TaloxConfig } from "../../types/config.js";
import type { TakeoverSummary, TaloxEventMap, TaloxEventType } from "../../types/events.js";
import type {
	AgentPageState,
	CompactVariant,
	DebugPageState,
	Point,
	ProfileClass,
	TaloxBug,
	TaloxNode,
	TaloxPageState,
	VisualDiffResult,
} from "../../types/index.js";
import { compactState } from "../../types/index.js";
import type { ObserveSessionOptions } from "../../types/session.js";
import type { TaloxSettings } from "../../types/settings.js";
// NOSONAR -- backward compat
import { DEFAULT_SETTINGS, resolveLegacyMode } from "../../types/settings.js"; // NOSONAR
import { formatAgentError } from "../AgentErrors.js";
import type { BrowserType } from "../BrowserManager.js";
import { type CaptchaSolver, registerSolver } from "../CaptchaSolver.js";
import type { ChallengeState } from "../ChallengeDetector.js";
import { ChallengeDetector } from "../ChallengeDetector.js";
import type { ChallengeOutcome } from "../ChallengeResolver.js";
import { ChallengeResolver } from "../ChallengeResolver.js";
import { type ContentSanitizer, createContentSanitizer } from "../ContentSanitizer.js";
import type { CrossOriginManager } from "../CrossOriginManager.js";
import { CrossOriginManager as CrossOriginManagerClass } from "../CrossOriginManager.js";
import type { HarRecorder, HarRecorderOptions } from "../HarRecorder.js";
import { HarRecorder as HarRecorderClass } from "../HarRecorder.js";
import { QualityTracker } from "../InteractionQuality.js";
import type { InspectServer as InspectServerType } from "../inspect/InspectServer.js";
import { InspectServer as InspectServerClass } from "../inspect/InspectServer.js";
import { createLogger } from "../Logger.js";
import { OriginHeaders } from "../OriginHeaders.js";
import type { PageStateCollector } from "../PageStateCollector.js";
import { SemanticMapper } from "../SemanticMapper.js";
import { SiteWarmupRegistry } from "../SiteWarmup.js";
import type { SkillLoader } from "../skills/SkillLoader.js";
import { AdaptationEngine } from "../smart/AdaptationEngine.js";
import type { VideoRecorder as VideoRecorderType } from "../VideoRecorder.js";
import { VideoRecorder as VideoRecorderClass } from "../VideoRecorder.js";
import {
	resolveVisual,
	type ScreenshotFormat,
	setScreenshotFormat,
	setVisualEmitter,
	setVisualReasoner,
	type VisualReasoner,
} from "../VisualReasoner.js";
import { ActionExecutor } from "./ActionExecutor.js";
import type { EventHandler } from "./EventBus.js";
import { EventBus } from "./EventBus.js";
import { SessionManager } from "./SessionManager.js";
import { TakeoverBridge } from "./TakeoverBridge.js";

export type { BehavioralDNA } from "../../types/index.js";
export type { AccelerationCurve, MovementStyle, TypingRhythm } from "./ActionExecutor.js";
export type { AttentionFrame } from "./SessionManager.js";

export type VerbosityLevel = 0 | 1 | 2 | 3;

export interface DebugSnapshot {
	state?: TaloxPageState;
	bugs: TaloxBug[];
	consoleErrors: string[];
	networkErrors: Array<{ url: string; status: number }>;
	lastAdaptation: import("../smart/AdaptationEngine.js").AdaptationRecord | null;
	verbosity: VerbosityLevel;
	timestamp: string;
}

// ─── TaloxController ─────────────────────────────────────────────────────────

/**
 * Main entry point for Talox v2 — stateful browser runtime for AI agents.
 *
 * All public methods delegate to focused sub-classes. `TaloxController` itself
 * is a thin coordination layer with no embedded logic.
 */
export class TaloxController {
	readonly _events: EventBus<TaloxEventMap>;
	readonly _actions: ActionExecutor;
	readonly _session: SessionManager;
	readonly _adapt: AdaptationEngine;
	readonly _takeover: TakeoverBridge;
	readonly _challenge: ChallengeDetector;
	private readonly _challengeResolver: ChallengeResolver = new ChallengeResolver();

	skillLoader?: SkillLoader; // NOSONAR — optional, set externally before launch

	settings: TaloxSettings;

	private attentionFrame: { x: number; y: number; width: number; height: number; selector?: string } | null = null;
	private readonly viewportScale: number = 1;

	private globalLastMousePos: Point = { x: 0, y: 0 };
	private useGlobalMousePos: boolean = true;

	private behavioralDNA: any = null;

	private takeoverState: "AGENT_RUNNING" | "WAITING_FOR_HUMAN" = "AGENT_RUNNING";
	private autoResumeTimer: NodeJS.Timeout | null = null;
	private readonly takeoverHistory: TakeoverSummary[] = [];
	private readonly observing: boolean;
	private originHeaders: OriginHeaders | null = null;
	private readonly originHeaderConfig: import("../../types/config.js").TaloxConfig["originHeaders"];
	private harRecorder: HarRecorder | null = null;
	private readonly harRecordingConfig: import("../../types/config.js").TaloxConfig["harRecording"];
	private crossOriginManager: CrossOriginManager | null = null;
	private inspectServer: InspectServerType | null = null;
	private readonly inspectServerConfig: import("../../types/config.js").TaloxConfig["inspectServer"];
	private videoRecorder: VideoRecorderType | null = null;
	private readonly videoRecordingConfig: import("../../types/config.js").TaloxConfig["videoRecording"];
	private readonly log = createLogger("Controller");
	private readonly _sanitizer: ContentSanitizer;
	readonly quality = new QualityTracker();

	constructor(baseDirOrConfig: string | TaloxConfig = ".", config: TaloxConfig = {}) {
		// Support TaloxController(config) shorthand when first arg is an object
		const baseDir = typeof baseDirOrConfig === "string" ? baseDirOrConfig : ".";
		const mergedConfig = typeof baseDirOrConfig === "object" ? baseDirOrConfig : config;
		// Start with defaults, then apply legacy mode if specified, then apply explicit settings
		let mergedSettings: TaloxSettings = { ...DEFAULT_SETTINGS };

		// Handle legacy mode mapping (v1 → v2 compatibility layer)
		if (mergedConfig.mode) {
			// NOSONAR — deprecated mode property for v1→v2 compat
			const legacySettings = resolveLegacyMode(mergedConfig.mode as import("../../types/settings.js").LegacyTaloxMode); // NOSONAR
			mergedSettings = { ...mergedSettings, ...legacySettings };
		}

		// Apply explicit settings overrides
		if (mergedConfig.settings) {
			mergedSettings = { ...mergedSettings, ...mergedConfig.settings };
		}

		this.settings = mergedSettings;
		this._sanitizer = createContentSanitizer(this.settings.contentSafety);

		if (mergedConfig.humanTakeover !== undefined) {
			if (typeof mergedConfig.humanTakeover === "boolean") {
				this.settings.humanTakeoverEnabled = mergedConfig.humanTakeover;
			} else {
				this.settings.humanTakeoverEnabled = true;
				if (mergedConfig.humanTakeover.timeoutMs !== undefined) {
					this.settings.humanTakeoverTimeoutMs = mergedConfig.humanTakeover.timeoutMs;
				}
			}
		}

		// humanTakeover or observe both need headed mode for UI
		if (mergedConfig.observe) {
			this.settings.headed = true;
		}

		// If humanTakeover is enabled, we need headed for the UI
		if (this.settings.humanTakeoverEnabled) {
			this.settings.headed = true;
		}

		this._events = new EventBus<TaloxEventMap>();
		setVisualEmitter((payload) => this._events.emit("visualQuestion", payload));
		this._challenge = new ChallengeDetector();
		this._session = new SessionManager(this.settings, this._events, baseDir);
		this._takeover = new TakeoverBridge(this._events, this.settings.humanTakeoverTimeoutMs);
		this.observing = Boolean(mergedConfig.observe);
		this._adapt = new AdaptationEngine(
			this.settings,
			this._events,
			async () => {
				const page = this._session.getPlaywrightPage();
				if (page) {
					await this._session.injectStealthScripts(page);
				}
			},
			this.observing,
		);
		this.attachTakeoverListeners();

		this.originHeaderConfig = mergedConfig.originHeaders;
		this.harRecordingConfig = mergedConfig.harRecording;
		this.inspectServerConfig = mergedConfig.inspectServer;
		this.videoRecordingConfig = mergedConfig.videoRecording;

		this._actions = new ActionExecutor(
			this.settings,
			this._events,
			this._session.artifactBuilder,
			this._session.policyEngine,
			new SemanticMapper(),
			() => this._session.getPage(),
			() => this._session.getActiveStateCollector(),
			() => this._session.profile,
			() => this.getCurrentLastMousePos(),
			(pos) => this.setCurrentLastMousePos(pos),
			() => this.attentionFrame,
			(x, y) => this.clampToFrame(x, y),
			(sel) => this.findElementInFrame(sel),
			undefined,
			() => this._session.recordActivity(),
			undefined, // fake cursor removed
			new SiteWarmupRegistry(),
		);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// LAUNCH & STOP
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Launch the browser and create/load a persistent profile.
	 *
	 * @param profileId    - Unique identifier for the browser profile.
	 * @param profileClass - `'ops'` | `'qa'` | `'sandbox'`
	 * @param browserType  - `'chromium'` | `'firefox'` | `'webkit'`. Defaults to `'chromium'`.
	 * @param options      - Launch options:
	 *                       - `headed`  — show browser window (default: from settings)
	 *                       - `overlay` — enable right-click context menu + annotation modal
	 *                       - `record`  — write session report on `stop()`
	 *                       - `output`  — `'json'` | `'markdown'` | `'both'` (default: `'both'`)
	 *                       - `outputDir` — where to write reports
	 *
	 * @example
	 * ```ts
	 * // Launch with default settings
	 * await talox.launch('test', 'qa');
	 *
	 * // Launch with browser options
	 * await talox.launch('ai-test', 'qa', 'chromium', {
	 *   headed: true,
	 *   overlay: true,
	 *   record:  true,
	 * });
	 * ```
	 */
	async launch(
		profileId: string,
		profileClass: ProfileClass,
		browserType: BrowserType = "chromium",
		observeOptions?: ObserveSessionOptions,
	): Promise<void> {
		this.behavioralDNA = this._session.generateBehavioralDNA(profileId);
		await this._session.launch(profileId, profileClass, this.settings, browserType, observeOptions);

		const page = this._session.getPlaywrightPage();
		if (!page) return;

		// headed:true activates the full agent overlay (cursor + glow + takeover button)
		try {
			await this._takeover.initialize(page, this.settings.headed);
		} catch (e) {
			await this._session.stop();
			throw new Error(`Takeover initialization failed: ${e instanceof Error ? e.message : String(e)}`);
		}

		this.setupOriginHeaders(page);
		this.setupHarRecording(page);
		this.setupCrossOriginManager(page);
		await this.setupInspectServer(page);
		this.setupVideoRecording(page);
	}

	/** Install per-origin headers if configured. */
	private setupOriginHeaders(page: import("playwright-core").Page): void {
		if (!this.originHeaderConfig) return;
		this.originHeaders = new OriginHeaders(this.originHeaderConfig);
		this.originHeaders.install(page);
	}

	/** Start HAR recording if configured. */
	private setupHarRecording(page: import("playwright-core").Page): void {
		if (!this.harRecordingConfig?.enabled) return;
		const harOpts: HarRecorderOptions = {
			outputPath: this.harRecordingConfig.outputPath,
		};
		if (this.harRecordingConfig.includeContent !== undefined) {
			harOpts.includeContent = this.harRecordingConfig.includeContent;
		}
		this.harRecorder = new HarRecorderClass(harOpts);
		this.harRecorder.start(page);
	}

	/** Install cross-origin iframe manager if enabled. */
	private setupCrossOriginManager(page: import("playwright-core").Page): void {
		if (!this.settings.enableCrossOriginIframes) return;
		this.crossOriginManager = new CrossOriginManagerClass();
		this.crossOriginManager.install(page);
	}

	/** Start inspect server if configured. */
	private async setupInspectServer(page: import("playwright-core").Page): Promise<void> {
		if (!this.inspectServerConfig) return;
		this.inspectServer = new InspectServerClass(this.inspectServerConfig);
		await this.inspectServer.attach(page);
		if (this.settings.verbosity >= 1) {
			this.log.info(`DevTools inspect server: ${this.inspectServer.getAddress()}`);
		}
	}

	/** Start video recording if configured. */
	private setupVideoRecording(page: import("playwright-core").Page): void {
		if (!this.videoRecordingConfig?.enabled) return;
		const vrOpts: { outputPath: string; fps?: number } = {
			outputPath: this.videoRecordingConfig.outputPath,
		};
		if (this.videoRecordingConfig.fps) vrOpts.fps = this.videoRecordingConfig.fps;
		this.videoRecorder = new VideoRecorderClass(vrOpts);
		this.videoRecorder.start(page);
		if (this.settings.verbosity >= 1) {
			this.log.info(`Video recording started → ${this.videoRecordingConfig.outputPath}`);
		}
	}

	/**
	 * Close the browser and finalise any active observe session.
	 */
	async stop(): Promise<void> {
		await this.flushHarRecorder();
		this.disposeCrossOriginManager();
		this.detachInspectServer();
		await this.flushVideoRecorder();
		this.persistTakeoverHistory();
		await this.disposeOriginHeaders();

		try {
			await this._session.stop();
		} catch (e) {
			this.log.error(`Error during stop(): ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	/** Flush HAR recording if active. */
	private async flushHarRecorder(): Promise<void> {
		if (!this.harRecorder) return;
		try {
			const result = await this.harRecorder.stop();
			if (this.settings.verbosity >= 1) {
				this.log.info(`HAR recording saved: ${result.outputPath} (${result.entryCount} entries)`);
			}
		} catch (e) {
			this.log.error(`HAR flush failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		this.harRecorder = null;
	}

	/** Dispose cross-origin iframe manager. */
	private disposeCrossOriginManager(): void {
		if (!this.crossOriginManager) return;
		this.crossOriginManager.dispose();
		this.crossOriginManager = null;
	}

	/** Detach inspect server if active. */
	private detachInspectServer(): void {
		if (!this.inspectServer) return;
		this.inspectServer.detach();
		this.inspectServer = null;
	}

	/** Flush video recording if active. */
	private async flushVideoRecorder(): Promise<void> {
		if (!this.videoRecorder) return;
		try {
			const outputPath = await this.videoRecorder.stop();
			if (this.settings.verbosity >= 1) {
				this.log.info(`Video recording saved: ${outputPath}`);
			}
		} catch (e) {
			this.log.error(`Video recording flush failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		this.videoRecorder = null;
	}

	/** Persist accumulated takeover history as a final artifact entry. */
	private persistTakeoverHistory(): void {
		if (this.takeoverHistory.length === 0) return;
		this._session.artifactBuilder.addAction("takeoverHistorySummary", {
			count: this.takeoverHistory.length,
			history: this.takeoverHistory,
		});
	}

	/** Dispose origin headers if active. */
	private async disposeOriginHeaders(): Promise<void> {
		if (!this.originHeaders) return;
		await this.originHeaders.dispose();
		this.originHeaders = null;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// HUMAN TAKEOVER
	// ═══════════════════════════════════════════════════════════════════════════

	// ═══════════════════════════════════════════════════════════════════════════
	// NAVIGATION & CORE ACTIONS
	// ═══════════════════════════════════════════════════════════════════════════

	/** Navigate to a URL and return the resulting page state. */
	async navigate(url: string): Promise<TaloxPageState> {
		try {
			const state = await this._actions.navigate(
				url,
				this._session.isFirstNavigation,
				(v) => {
					this._session.isFirstNavigation = v;
				},
				this._session.lastState,
				this._session.rulesEngine,
			);
			this._session.lastState = state;
			// Inject domain hints from matching skills
			this.injectDomainHints(state, url);
			const adapted = await this._adapt.evaluate(state);
			if (!adapted) this._adapt.recordStrategySuccess(state.url);
			return state;
		} catch (error: unknown) {
			return this.buildErrorState(error);
		}
	}

	/**
	 * Collect and return the current page state without navigating.
	 * Runs the rules engine over the result so `state.bugs` is populated.
	 *
	 * Pass an optional `variant` to get a compact representation:
	 * - `'full'`  — full `TaloxPageState` (default)
	 * - `'agent'` — minimal LLM-friendly view (url, title, interactiveElements, consoleErrors, bugs)
	 * - `'debug'` — forensics view (url, title, full nodes, console, network, bugs)
	 */
	async getState(): Promise<TaloxPageState>;
	async getState(variant: "full"): Promise<TaloxPageState>;
	async getState(variant: "agent"): Promise<AgentPageState>;
	async getState(variant: "debug"): Promise<DebugPageState>;
	async getState(variant?: CompactVariant): Promise<TaloxPageState | AgentPageState | DebugPageState> {
		try {
			const state = await this._session.getActiveStateCollector().collect();
			state.bugs.push(...this._session.rulesEngine.analyze(state));
			this._session.lastState = state;
			if (!variant || variant === "full") return state;
			if (variant === "agent") return this._sanitizer.sanitizeAgentState(compactState(state, "agent"));
			return compactState(state, "debug");
		} catch (error: unknown) {
			return this.buildErrorState(error);
		}
	}

	/**
	 * Analyze the current page for human-meaningful obstacles (CAPTCHA, login wall,
	 * Cloudflare challenge, consent wall, etc.) and return a structured `ChallengeState`.
	 *
	 * Unlike `BotDetector` (which drives internal stealth adaptation), this method
	 * surfaces challenge types that the *agent* needs to act on — e.g. request human
	 * takeover, click "Accept cookies", or wait for SPA hydration.
	 *
	 * @example
	 * ```ts
	 * const challenge = await talox.getChallengeState();
	 * if (challenge.primaryChallenge?.requiresHuman) {
	 *   await talox.requestHumanTakeover(challenge.primaryChallenge.suggestedTakeoverReason);
	 * }
	 * ```
	 */
	async getChallengeState(): Promise<ChallengeState> {
		const state = this._session.lastState ?? (await this.getState());
		return this._challenge.analyze(state);
	}

	/** Attempt to auto-resolve the current challenge. */
	async resolveChallenge(): Promise<ChallengeOutcome> {
		const challengeState = await this.getChallengeState();
		if (!challengeState.primaryChallenge) {
			return { resolved: true, requiresHuman: false, attempts: [], totalAttempts: 0, finalStrategy: "skipped" };
		}
		const page = this._session.getPlaywrightPage();
		if (!page) throw new Error("No active page");
		return this._challengeResolver.resolve(challengeState.primaryChallenge, page);
	}

	/** Click an element by CSS selector. Self-heals on failure. */
	async click(selector: string): Promise<TaloxPageState> {
		try {
			const state = await this._actions.click(selector);
			const adapted = await this._adapt.evaluate(state);
			if (!adapted) this._adapt.recordStrategySuccess(state.url);
			return state;
		} catch (error: unknown) {
			return this.buildErrorState(error);
		}
	}

	/** Type text into an element by CSS selector. Self-heals on failure. */
	async type(selector: string, text: string): Promise<TaloxPageState> {
		try {
			return await this._actions.type(selector, text);
		} catch (error: unknown) {
			return this.buildErrorState(error);
		}
	}

	/** Move the mouse to absolute viewport coordinates. */
	async mouseMove(x: number, y: number): Promise<void> {
		return this._actions.mouseMove(x, y);
	}

	/** Scroll an element into view. */
	async scrollTo(selector: string, align: "start" | "center" | "end" | "nearest" = "center"): Promise<void> {
		return this._actions.scrollTo(selector, align);
	}

	/** Take a screenshot of the full page or a specific element. */
	async screenshot(options?: { selector?: string; path?: string }): Promise<Buffer | string> {
		return this._actions.screenshot(options);
	}

	/**
	 * Capture an annotated screenshot with numbered labels overlaid on each
	 * interactive element, showing element refs (e.g. "@e1", "@e2") at the
	 * top-left corner of their bounding boxes.
	 */
	async annotatedScreenshot(): Promise<Buffer> {
		const state = await this.getState();
		const elements = state.interactiveElements
			.filter((el) => el.boundingBox)
			.map((el, idx) => ({
				ref: `@e${idx + 1}`,
				x: el.boundingBox.x,
				y: el.boundingBox.y,
				width: el.boundingBox.width,
				height: el.boundingBox.height,
			}));

		const { GhostVisualizer } = await import("../GhostVisualizer.js");
		const visualizer = new GhostVisualizer();
		const page = this._session.getPlaywrightPage();
		if (!page) {
			throw new Error("No active page. Call launch() first.");
		}
		return visualizer.annotateScreenshot(page, elements);
	}

	/** Extract table data as JSON array. */
	async extractTable(selector: string): Promise<Array<Record<string, string>>> {
		return this._actions.extractTable(selector);
	}

	/** Find an element by text or accessible name. */
	async findElement(
		text: string,
		elementType?: "button" | "link" | "input" | "checkbox" | "radio" | "menuitem" | "any",
	): Promise<{ selector: string; boundingBox: { x: number; y: number; width: number; height: number } } | null> {
		return this._actions.findElement(text, elementType, this._session.lastState);
	}

	/** Execute JavaScript in the browser context. */
	async evaluate<T = any>(script: string): Promise<T> {
		return this._actions.evaluate<T>(script);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// WAIT HELPERS
	// ═══════════════════════════════════════════════════════════════════════════

	async waitForSelector(selector: string, timeout = 30000): Promise<void> {
		return this._actions.waitForSelector(selector, timeout);
	}

	async waitForNavigation(timeout = 30000): Promise<void> {
		return this._actions.waitForNavigation(timeout);
	}

	async waitForLoadState(state: "load" | "domcontentloaded" | "networkidle", timeout = 30000): Promise<void> {
		return this._actions.waitForLoadState(state, timeout);
	}

	async waitForTimeout(ms: number): Promise<void> {
		return this._actions.waitForTimeout(ms);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// HUMAN SIMULATION
	// ═══════════════════════════════════════════════════════════════════════════

	async fidget(durationMs = 1500): Promise<void> {
		return this._actions.fidget(durationMs);
	}

	async think(durationMs = 2000): Promise<void> {
		return this._actions.think(durationMs);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// VERBOSITY
	// ═══════════════════════════════════════════════════════════════════════════

	setVerbosity(level: VerbosityLevel): void {
		this.settings.verbosity = level;
		this._events.emit("verbosityChanged", { level });
	}

	getVerbosity(): VerbosityLevel {
		return this.settings.verbosity;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// DIAGNOSTIC SNAPSHOT
	// ═══════════════════════════════════════════════════════════════════════════

	async getDebugSnapshot(): Promise<DebugSnapshot> {
		const state = this._session.lastState;
		const snapshot: DebugSnapshot = {
			bugs: state?.bugs ?? [],
			consoleErrors: state?.console?.errors ?? [],
			networkErrors: state?.network?.failedRequests ?? [],
			lastAdaptation: this._adapt.getLastAdaptation() ?? null,
			verbosity: this.settings.verbosity,
			timestamp: new Date().toISOString(),
		};
		if (state) {
			snapshot.state = state;
		}
		return snapshot;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// HEADED MODE
	// ═══════════════════════════════════════════════════════════════════════════

	async setHeaded(headed: boolean): Promise<void> {
		this.settings.headed = headed;
		await this._session.setHeadedMode(headed);
	}

	isHeaded(): boolean {
		return this.settings.headed;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// SAFE MODE
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Enable or disable deterministic safe mode.
	 *
	 * Safe mode disables all human simulation — no jitter, no random delays,
	 * no typos, raw direct Playwright clicks. Use it when testing your own
	 * application and you want fast, predictable, bit-identical interactions.
	 * Opposite of biomechanical mode.
	 *
	 * @param enabled  - `true` to enable safe mode, `false` to restore normal mode.
	 */
	setSafeMode(enabled: boolean): void {
		this.settings.safeMode = enabled;
	}

	isSafeMode(): boolean {
		return this.settings.safeMode;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// HUMAN TAKEOVER STATE MACHINE
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Freeze the agent and hand control to the human.
	 * The overlay switches from cyan to "Resume" state.
	 * Resolves when the human clicks Resume or the timeout fires.
	 */
	async requestHumanTakeover(reason?: string): Promise<void> {
		if (this.takeoverState === "WAITING_FOR_HUMAN") return;

		return new Promise<void>((resolve) => {
			this._events.once("agentResumed", (_e) => resolve());

			this.takeoverState = "WAITING_FOR_HUMAN";
			// TakeoverBridge listens to this event to update the overlay
			this._takeover.requestTakeover(reason).catch((e) => {
				this.log.error(`Takeover request failed: ${e instanceof Error ? e.message : String(e)}`);
			});

			if (this.settings.humanTakeoverTimeoutMs > 0) {
				this.autoResumeTimer = setTimeout(() => {
					this.resumeAgent();
				}, this.settings.humanTakeoverTimeoutMs);
			}
		});
	}

	/**
	 * Resume agent control after a human takeover.
	 * Overlay sweeps cursor back in from screen edge.
	 */
	resumeAgent(): void {
		if (this.takeoverState !== "WAITING_FOR_HUMAN") return;

		if (this.autoResumeTimer) {
			clearTimeout(this.autoResumeTimer);
			this.autoResumeTimer = null;
		}

		this.takeoverState = "AGENT_RUNNING";
		// TakeoverBridge listens to this event to restore the overlay
		this._takeover.resumeAgent();
	}

	getTakeoverState(): "AGENT_RUNNING" | "WAITING_FOR_HUMAN" {
		return this.takeoverState;
	}

	getTakeoverHistory(): TakeoverSummary[] {
		return [...this.takeoverHistory];
	}

	private attachTakeoverListeners(): void {
		this._events.on("humanTakeoverRequested", (payload) => this.recordTakeoverRequest(payload));
		this._events.on("agentResumed", (payload) => this.recordTakeoverResume(payload));
	}

	private recordTakeoverRequest(payload: TaloxEventMap["humanTakeoverRequested"]): void {
		this._session.artifactBuilder.addAction("takeoverRequested", payload);
	}

	private recordTakeoverResume(payload: TaloxEventMap["agentResumed"]): void {
		if (payload.summary) {
			this.takeoverHistory.push(payload.summary);
			this._session.artifactBuilder.addAction("takeoverResumed", payload.summary);
		} else {
			this._session.artifactBuilder.addAction("takeoverResumed", payload);
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// SETTINGS
	// ═══════════════════════════════════════════════════════════════════════════

	getSettings(): TaloxSettings {
		return { ...this.settings };
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// BEHAVIORAL DNA
	// ═══════════════════════════════════════════════════════════════════════════

	generateBehavioralDNA(profileId: string): any {
		this.behavioralDNA = this._session.generateBehavioralDNA(profileId);
		return this.behavioralDNA;
	}

	setBehavioralDNA(dna: Partial<any>): void {
		this.behavioralDNA = {
			jitterFrequency: dna.jitterFrequency ?? 0.5,
			accelerationCurve: dna.accelerationCurve ?? "ease-out",
			typingRhythm: dna.typingRhythm ?? "medium",
			clickPrecision: dna.clickPrecision ?? 0.75,
			movementStyle: dna.movementStyle ?? "smooth",
		};
		this._session.artifactBuilder.addAction("setBehavioralDNA", { dna: this.behavioralDNA });
	}

	getBehavioralDNA(): any {
		return this.behavioralDNA;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// ATTENTION FRAME
	// ═══════════════════════════════════════════════════════════════════════════

	async setAttentionFrame(
		selector: string,
	): Promise<{ x: number; y: number; width: number; height: number; selector?: string }> {
		const page = this._session.getPage();
		const element = await page.$(selector);
		if (!element) throw new Error(`Element not found for selector: ${selector}`);
		const box = await element.boundingBox();
		if (!box) throw new Error(`Unable to get bounding box for selector: ${selector}`);
		this.attentionFrame = { ...box, selector };
		this._session.artifactBuilder.addAction("setAttentionFrame", { selector, frame: this.attentionFrame });
		return this.attentionFrame!;
	}

	setAttentionFrameBox(x: number, y: number, width: number, height: number) {
		this.attentionFrame = { x, y, width, height };
		this._session.artifactBuilder.addAction("setAttentionFrameBox", { x, y, width, height });
		return this.attentionFrame;
	}

	clearAttentionFrame(): void {
		this.attentionFrame = null;
		this._session.artifactBuilder.addAction("clearAttentionFrame", {});
	}

	getAttentionFrame() {
		return this.attentionFrame;
	}

	isElementInFrame(elementBox: { x: number; y: number; width: number; height: number }): boolean {
		if (!this.attentionFrame) return true;
		const f = this.attentionFrame;
		const cx = elementBox.x + elementBox.width / 2;
		const cy = elementBox.y + elementBox.height / 2;
		return cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height;
	}

	async getElementsInFrame(): Promise<TaloxNode[]> {
		if (!this.attentionFrame) throw new Error("No attention frame set.");
		const allNodes: TaloxNode[] = this._session.lastState?.nodes ?? [];
		return allNodes.filter((n) => n.boundingBox && this.isElementInFrame(n.boundingBox));
	}

	async findElementInFrame(selector: string): Promise<{ element: any; box: any } | null> {
		const page = this._session.getPage();
		const elements = await page.$$(selector);
		if (elements.length === 0) return null;
		for (const el of elements) {
			const box = await el.boundingBox();
			if (box && this.isElementInFrame(box)) return { element: el, box };
		}
		if (!this.attentionFrame) {
			const box = await elements[0]?.boundingBox();
			if (box) return { element: elements[0], box };
		}
		return null;
	}

	scaleAXToViewport(axX: number, axY: number, axWidth: number, axHeight: number) {
		if (!this.attentionFrame) return { x: axX, y: axY, width: axWidth, height: axHeight };
		return {
			x: this.attentionFrame.x + axX * this.attentionFrame.width,
			y: this.attentionFrame.y + axY * this.attentionFrame.height,
			width: axWidth * this.attentionFrame.width,
			height: axHeight * this.attentionFrame.height,
		};
	}

	viewportToScaleAX(vpX: number, vpY: number) {
		if (!this.attentionFrame) return { axX: vpX, axY: vpY };
		return {
			axX: (vpX - this.attentionFrame.x) / this.attentionFrame.width,
			axY: (vpY - this.attentionFrame.y) / this.attentionFrame.height,
		};
	}

	clampToFrame(x: number, y: number): Point {
		if (!this.attentionFrame) return { x, y };
		const f = this.attentionFrame;
		return {
			x: Math.max(f.x, Math.min(x, f.x + f.width)),
			y: Math.max(f.y, Math.min(y, f.y + f.height)),
		};
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// MULTI-PAGE
	// ═══════════════════════════════════════════════════════════════════════════

	async openPage(url: string): Promise<TaloxPageState> {
		return this._session.openPage(url);
	}
	async closePage(index: number): Promise<void> {
		return this._session.closePage(index);
	}
	switchPage(index: number): void {
		return this._session.switchPage(index);
	}
	getPageCount(): number {
		return this._session.getPageCount();
	}
	getActivePageIndex(): number {
		return this._session.getActivePageIndex();
	}
	getActivePage(): PageStateCollector | null {
		return this._session.getActivePage();
	}
	getPlaywrightPage(): any {
		return this._session.getPlaywrightPage();
	}
	getAllPages(): PageStateCollector[] {
		return this._session.getAllPages();
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// VISUAL VERIFICATION
	// ═══════════════════════════════════════════════════════════════════════════

	async verifyVisual(baselineKey: string, autoSave = false): Promise<VisualDiffResult & { isMatch: boolean }> {
		return this._session.verifyVisual(baselineKey, autoSave);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// ADAPTIVE STEALTH
	// ═══════════════════════════════════════════════════════════════════════════

	setAdaptiveStealthEnabled(enabled: boolean): void {
		this._actions.setAdaptiveStealthEnabled(enabled);
	}
	setAdaptiveStealthSensitivity(sensitivity: number): void {
		this._actions.setAdaptiveStealthSensitivity(sensitivity);
	}
	setAdaptiveStealthRadius(radius: number): void {
		this._actions.setAdaptiveStealthRadius(radius);
	}
	async calculateElementDensity(x: number, y: number) {
		return this._actions.calculateElementDensity(x, y);
	}
	getAdaptiveMouseSpeed(density: number): number {
		return this._actions.getAdaptiveMouseSpeed(density);
	}
	getAdaptiveJitter(density: number): number {
		return this._actions.getAdaptiveJitter(density);
	}
	async getEffectiveMouseSpeed(x: number, y: number) {
		return this._actions.getEffectiveMouseSpeed(x, y);
	}
	async getEffectiveJitter(x: number, y: number) {
		return this._actions.getEffectiveJitter(x, y);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// PRECISION DECAY
	// ═══════════════════════════════════════════════════════════════════════════

	getPrecisionOffset(): Point {
		return this._actions.getPrecisionOffset();
	}
	setPrecisionDecay(decay: number): void {
		this._actions.setPrecisionDecay(decay);
	}
	getPrecisionDecay(): number {
		return this._actions.getPrecisionDecay();
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// AUTO-THINKING
	// ═══════════════════════════════════════════════════════════════════════════

	startAutoThinking(): void {
		this._session.startAutoThinking(this.behavioralDNA);
	}
	stopAutoThinking(): void {
		this._session.stopAutoThinking();
	}
	isAutoThinkingRunning(): boolean {
		return this._session.isAutoThinkingRunning();
	}
	setAutomaticThinkingEnabled(enabled: boolean): void {
		this.settings.automaticThinkingEnabled = enabled;
	}
	setIdleTimeout(timeoutMs: number): void {
		this._session.setIdleTimeout(timeoutMs);
	}
	recordActivity(): void {
		this._session.recordActivity();
	}
	async triggerThinkingBehavior(): Promise<void> {
		return this._session.triggerThinkingBehavior(
			this.getCurrentLastMousePos(),
			this.attentionFrame,
			this.clampToFrame.bind(this),
		);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// MOUSE TRACKING
	// ═══════════════════════════════════════════════════════════════════════════

	setGlobalMouseTracking(enabled: boolean): void {
		this.useGlobalMousePos = enabled;
	}

	private getCurrentLastMousePos(): Point {
		if (this.useGlobalMousePos) return this.globalLastMousePos;
		return this._session.pageMousePositions.get(this._session.activePageIndex) ?? { x: 0, y: 0 };
	}

	private setCurrentLastMousePos(pos: Point): void {
		if (this.useGlobalMousePos) {
			this.globalLastMousePos = pos;
		} else {
			this._session.pageMousePositions.set(this._session.activePageIndex, pos);
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// AUTONOMOUS RESEARCH
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Run a full autonomous research cycle. The system generates hypotheses,
	 * runs A/B experiments, promotes winning strategies, and optionally writes
	 * new skills via the SkillWriter feedback loop.
	 *
	 * Returns a {@link ResearchResult} with experiments, evaluations, and any
	 * promoted strategies.
	 *
	 * @param goal    - The task goal description (and optional startUrl, strategy, etc.)
	 * @param domain  - Domain label for the experiment (e.g. "github.com")
	 * @param options - Optional research config overrides + skillsDir for feedback
	 */
	async runResearch(
		goal: import("../loop/types.js").TaskGoal,
		domain: string,
		options?: {
			config?: Partial<import("../research/types.js").AutoResearchConfig>;
			skillsDir?: string;
			planner?: import("../loop/Planner.js").Planner;
		},
	): Promise<import("../research/types.js").ResearchResult> {
		const { AutoResearchLoop } = await import("../research/AutoResearchLoop.js");

		const researchDir = options?.config?.researchDir ?? ".talox/research";
		const config: Partial<import("../research/types.js").AutoResearchConfig> = {
			...options?.config,
			researchDir,
		};

		const loopFactory = async (params: Record<string, unknown>) => {
			const { AutonomousLoop } = await import("../loop/AutonomousLoop.js");
			const loopOpts: import("../loop/types.js").AutonomousLoopOptions = {
				goal: {
					description: (params.description as string) ?? goal.description,
					maxIterations: (params.maxIterations as number) ?? goal.maxIterations,
					strategy: (params.strategy as import("../loop/types.js").LoopStrategy) ?? goal.strategy ?? "balanced",
					startUrl: (params.startUrl as string) ?? goal.startUrl,
				},
				planner: {
					model: (params.model as string) ?? "gpt-4o",
					apiKey: (params.apiKey as string) ?? process.env["OPENAI_API_KEY"],
				},
				...(options?.skillsDir ? { skillsDir: options.skillsDir } : {}),
				...(options?.planner ? { plannerOverride: options.planner } : {}),
			};
			return new AutonomousLoop(this, loopOpts);
		};

		const researchOpts: {
			config?: Partial<import("../research/types.js").AutoResearchConfig>;
			planner?: import("../loop/Planner.js").Planner;
		} = {};
		if (Object.keys(config).length > 0) {
			researchOpts.config = config;
		}
		if (options?.planner) {
			researchOpts.planner = options.planner;
		}
		const research = new AutoResearchLoop(loopFactory, researchOpts);
		const result = await research.run(goal, domain);

		// ── Feedback: promoted strategies → DomainMemory sync ──
		for (const promo of result.promotions) {
			// Record the winning strategy in DomainMemory for future adaptation
			this._adapt.domainMemory.record(promo.domain, promo.strategyName, true);
		}

		// ── Feedback: promoted strategies → SkillWriter ──
		if (options?.skillsDir && result.promotions.length > 0) {
			const { SkillLoader } = await import("../skills/SkillLoader.js");
			const { SkillWriter } = await import("../skills/SkillWriter.js");
			const loader = new SkillLoader([options.skillsDir]);
			const writer = new SkillWriter(options.skillsDir, loader);

			for (const promo of result.promotions) {
				await writer.createSkill({
					name: `promoted_${promo.strategyName}`,
					description: `Auto-promoted strategy "${promo.strategyName}" for domain ${promo.domain}`,
					domain: promo.domain,
					version: "1.0",
					content: [
						`# Promoted Strategy: ${promo.strategyName}`,
						``,
						`**Domain:** ${promo.domain}`,
						`**Promoted at:** ${promo.promotedAt}`,
						`**Evidence:** ${promo.evidence.join(", ")}`,
						``,
						`## Winning Parameters`,
						"",
						"```json",
						JSON.stringify(promo.winningParameters, null, 2),
						"```",
					].join("\n"),
					triggerCondition: `domain == "${promo.domain}"`,
					toolUsage: [],
				});
			}

			// Re-load skills so they're immediately available
			if (this.skillLoader) {
				this.skillLoader = loader;
			}
		}

		return result;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// SEMANTIC SEARCH HELPERS
	// ═══════════════════════════════════════════════════════════════════════════

	findNodeByText(text: string, fuzzy = false): TaloxNode | null {
		const nodes: TaloxNode[] = this._session.getActiveStateCollector().getLastNodes();
		const norm = fuzzy ? text.toLowerCase() : text;
		return (
			nodes.find((n) => {
				const t = fuzzy ? (n.name ?? "").toLowerCase() : (n.name ?? "");
				return fuzzy ? t.includes(norm) : t === norm;
			}) ?? null
		);
	}

	findNodesByText(text: string, fuzzy = false): TaloxNode[] {
		const nodes: TaloxNode[] = this._session.getActiveStateCollector().getLastNodes();
		const norm = fuzzy ? text.toLowerCase() : text;
		return nodes.filter((n) => {
			const t = fuzzy ? (n.name ?? "").toLowerCase() : (n.name ?? "");
			return fuzzy ? t.includes(norm) : t === norm;
		});
	}

	findNodeByRole(role: string): TaloxNode | null {
		const nodes: TaloxNode[] = this._session.getActiveStateCollector().getLastNodes();
		const r = role.toLowerCase();
		return nodes.find((n) => (n.role ?? "").toLowerCase() === r) ?? null;
	}

	findNodesByRole(roles: string[]): TaloxNode[] {
		const nodes: TaloxNode[] = this._session.getActiveStateCollector().getLastNodes();
		const rs = new Set(roles.map((r) => r.toLowerCase()));
		return nodes.filter((n) => rs.has((n.role ?? "").toLowerCase()));
	}

	findInteractiveNodes(): TaloxNode[] {
		return this.findNodesByRole([
			"button",
			"link",
			"textbox",
			"checkbox",
			"radio",
			"combobox",
			"menu",
			"menuitem",
			"tab",
			"slider",
			"switch",
			"searchbox",
			"input",
			"textarea",
			"anchor",
		]);
	}

	compressStateForLLM(state: TaloxPageState): any {
		const interactive = new Set([
			"button",
			"link",
			"textbox",
			"checkbox",
			"radio",
			"combobox",
			"menu",
			"menuitem",
			"tab",
			"slider",
			"switch",
			"searchbox",
			"input",
			"listbox",
			"option",
		]);
		const pruned = state.nodes.filter((n) => {
			const role = (n.role ?? "").toLowerCase();
			if (interactive.has(role)) return true;
			if (role === "statictext" || role === "text") return (n.name ?? "").trim().length > 0;
			if (role === "heading") return true;
			return false;
		});
		return {
			url: state.url,
			title: state.title,
			nodes: pruned.map((n) => ({ role: n.role, name: n.name, value: n.attributes?.["value"], id: n.id })),
		};
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// PAGE DESCRIPTION
	// ═══════════════════════════════════════════════════════════════════════════

	async describePage(): Promise<string> {
		const state = this._session.lastState;
		if (!state) return "No page loaded yet. Call navigate() first.";

		const { SemanticMapper } = await import("../SemanticMapper.js");
		const mapper = new SemanticMapper();
		const entities = mapper.mapNodes(state.nodes, state.url);
		const inter = mapper.filterInteractive(entities);
		const grouped = mapper.groupByType(inter);

		const parts: string[] = [`Page: "${state.title}" at ${state.url}`];
		const forms = grouped.get("form");
		if (forms?.length) parts.push(`Contains ${forms.length} form(s).`);
		const inputs = grouped.get("input");
		if (inputs?.length)
			parts.push(
				`Input fields: ${inputs
					.slice(0, 5)
					.map((e) => e.label)
					.join(", ")}`,
			);
		const buttons = grouped.get("button");
		if (buttons?.length)
			parts.push(
				`Buttons: ${buttons
					.slice(0, 5)
					.map((e) => e.label)
					.join(", ")}`,
			);
		const links = grouped.get("link");
		if (links?.length) parts.push(`Links: ${links.length} link(s) on page`);
		if (state.console.errors.length) parts.push(`Console errors: ${state.console.errors.length}`);
		if (state.bugs.length) parts.push(`Detected ${state.bugs.length} bug(s)`);
		return parts.join(" ");
	}

	async getIntentState() {
		const state = this._session.lastState;
		if (!state) return { pageType: "unknown", primaryAction: null, inputs: [], errors: [], bugs: [] };

		const { SemanticMapper } = await import("../SemanticMapper.js");
		const mapper = new SemanticMapper();
		const entities = mapper.mapNodes(state.nodes, state.url);
		const inter = mapper.filterInteractive(entities);
		const sorted = mapper.sortByPosition(inter);

		const url = state.url.toLowerCase();
		let pageType = "unknown";
		if (/login|signin/.test(url)) pageType = "login";
		else if (/checkout|cart/.test(url)) pageType = "checkout";
		else if (/search|results/.test(url)) pageType = "search";
		else if (/product|item/.test(url)) pageType = "product";
		else if (/article|post|blog/.test(url)) pageType = "article";
		else if (inter.some((e) => e.type === "form")) pageType = "form";

		return {
			pageType,
			primaryAction: sorted[0] ? { type: sorted[0].type, label: sorted[0].label, selector: sorted[0].id } : null,
			inputs: inter
				.filter((e) => e.type === "input" || e.type === "search")
				.slice(0, 10)
				.map((e) => ({ label: e.label, type: e.role, id: e.id })),
			errors: state.console.errors,
			bugs: state.bugs.map((b) => ({ type: b.type, severity: b.severity })),
		};
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// HUMAN-IN-THE-LOOP HOOK
	// ═══════════════════════════════════════════════════════════════════════════

	setOnRiskyActionHook(hook: (action: string, target: string) => Promise<boolean>): void {
		this._actions.setRiskyActionHook(hook);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// EVENTS — legacy-compatible API
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Register an external CAPTCHA solver.
	 *
	 * Solvers are tried in registration order when a captcha is detected.
	 * Built-in providers: `createTwoCaptchaSolver()`, `createCapSolverSolver()`.
	 * Custom solvers: implement the `CaptchaSolver` interface.
	 *
	 * @example
	 * ```ts
	 * import { createTwoCaptchaSolver } from "talox";
	 * talox.useSolver(createTwoCaptchaSolver({ apiKey: "YOUR_KEY" }));
	 * ```
	 */
	/**
	 * Register a visual reasoning plugin (VLM).
	 *
	 * Once registered, the perception stack can answer visual questions
	 * about pages via `perception.askVisual("What is on this page?")`.
	 *
	 * Pass `null` to clear the reasoner.
	 *
	 * @example
	 * ```ts
	 * import { createOpenAIVisionReasoner } from "talox-vlm-openai";
	 * talox.useVision(createOpenAIVisionReasoner({ apiKey: "..." }));
	 * ```
	 */
	/**
	 * Resolve a visual question previously emitted via the `visualQuestion` event.
	 *
	 * Called by the hosting agent (Claude Code, Codex, Gemini CLI) after
	 * processing the screenshot with its own vision model.
	 *
	 * @param id     The ID from the `visualQuestion` event payload
	 * @param answer The answer to the visual question
	 */
	resolveVisual(id: string, answer: string): void {
		resolveVisual(id, answer);
	}

	/**
	 * Set the screenshot format for `visualQuestion` events.
	 *
	 * - `"base64"` — data URL (default, works everywhere)
	 * - `"file"` — file path (for agents that read from disk)
	 * - `"buffer"` — raw base64 (for in-process SDK usage)
	 */
	setScreenshotFormat(format: ScreenshotFormat): void {
		setScreenshotFormat(format);
	}

	useVision(reasoner: VisualReasoner | null): void {
		setVisualReasoner(reasoner);
	}

	useSolver(solver: CaptchaSolver): void {
		registerSolver(solver);
	}

	/**
	 * Subscribe to a Talox event.
	 *
	 * @example
	 * ```ts
	 * talox.on('sessionEnd', (e) => console.log(e.reportPath));
	 * talox.on('adapted',    (e) => console.log(e.reason));
	 * ```
	 */
	on<K extends keyof TaloxEventMap>(eventType: K, handler: EventHandler<TaloxEventMap[K]>): void {
		this._events.on(eventType, handler);
	}

	off<K extends keyof TaloxEventMap>(eventType: K, handler: EventHandler<TaloxEventMap[K]>): void {
		this._events.off(eventType, handler);
	}

	removeAllListeners(): void {
		this._events.removeAllListeners();
	}

	getEventListeners(): Map<TaloxEventType, number> {
		return this._events.getListenerCounts();
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR HANDLING
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Build a minimal {@link TaloxPageState} from a caught error, using
	 * {@link formatAgentError} to produce an AI-friendly message.
	 */
	private buildErrorState(error: unknown): TaloxPageState {
		const friendlyMessage = formatAgentError(error);
		return {
			url: "",
			title: "Error",
			timestamp: new Date().toISOString(),
			console: { errors: [friendlyMessage] },
			network: { failedRequests: [] },
			nodes: [],
			interactiveElements: [],
			bugs: [],
		};
	}

	/**
	 * Inject domain hints from the SkillLoader into the page state.
	 * Matches the URL's hostname against loaded skills and populates
	 * `state.domainHints` with formatted skill prompt content.
	 */
	private injectDomainHints(state: TaloxPageState, url: string): void {
		if (!this.skillLoader) return;
		try {
			const hostname = new URL(url).hostname;
			const matched = this.skillLoader.matchDomain(hostname);
			if (matched.length > 0) {
				state.domainHints = matched.map((s) => this.skillLoader!.toPrompt(s.manifest.name));
			}
		} catch {
			// NOSONAR — invalid URL, skip domain hints
		}
	}
}
