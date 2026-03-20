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

import type {
  TaloxProfile,
  TaloxPageState,
  ProfileClass,
  Point,
  VisualDiffResult,
  TaloxNode,
  TaloxBug,
} from '../../types/index.js';
import type { TaloxEventMap, TaloxEventType, TaloxEvent } from '../../types/events.js';
import type { ObserveSessionOptions }     from '../../types/session.js';
import type { BrowserType }              from '../BrowserManager.js';
import type { TaloxConfig }              from '../../types/config.js';
import type { TaloxSettings }            from '../../types/settings.js';

import { EventBus }                      from './EventBus.js';
import { ActionExecutor }                from './ActionExecutor.js';
import { SessionManager }               from './SessionManager.js';
import { TakeoverBridge }               from './TakeoverBridge.js';
import { AdaptationEngine }              from '../smart/AdaptationEngine.js';
import { PageStateCollector }           from '../PageStateCollector.js';
import { SemanticMapper }                from '../SemanticMapper.js';
import { DEFAULT_SETTINGS }              from '../../types/settings.js';

export type { AttentionFrame }           from './SessionManager.js';
export type { MovementStyle, TypingRhythm, AccelerationCurve } from './ActionExecutor.js';
export type { BehavioralDNA }          from '../../types/index.js';

export interface DebugSnapshot {
  state?: TaloxPageState;
  bugs: TaloxBug[];
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status: number }>;
  lastAdaptation: any;
  verbosity: 0 | 1 | 2 | 3;
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
  readonly _events:  EventBus<TaloxEventMap>;
  readonly _actions: ActionExecutor;
  readonly _session: SessionManager;
  readonly _adapt:   AdaptationEngine;
  readonly _takeover: TakeoverBridge;

  settings: TaloxSettings;

  private attentionFrame: { x: number; y: number; width: number; height: number; selector?: string } | null = null;
  private viewportScale:  number = 1.0;

  private globalLastMousePos:   Point    = { x: 0, y: 0 };
  private useGlobalMousePos:    boolean  = true;

  private behavioralDNA: any = null;

  private takeoverState: 'AGENT_RUNNING' | 'WAITING_FOR_HUMAN' = 'AGENT_RUNNING';
  private autoResumeTimer: NodeJS.Timeout | null = null;

  constructor(baseDir: string = '.', config: TaloxConfig = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...config.settings };

    if (config.humanTakeover !== undefined) {
      if (typeof config.humanTakeover === 'boolean') {
        this.settings.humanTakeoverEnabled = config.humanTakeover;
      } else {
        this.settings.humanTakeoverEnabled = true;
        if (config.humanTakeover.timeoutMs !== undefined) {
          this.settings.humanTakeoverTimeoutMs = config.humanTakeover.timeoutMs;
        }
      }
    }

    // humanTakeover or observe both need headed mode for UI
    if (config.observe) {
      this.settings.headed = true;
    }
    
    // If humanTakeover is enabled, we need headed for the UI
    if (this.settings.humanTakeoverEnabled) {
      this.settings.headed = true;
    }

    this._events   = new EventBus<TaloxEventMap>();
    this._session = new SessionManager(this.settings, this._events, baseDir);
    this._takeover = new TakeoverBridge(
      this._events,
      this.settings.humanTakeoverTimeoutMs,
    );
    this._adapt   = new AdaptationEngine(this.settings, this._events, async () => {
      const page = this._session.getPlaywrightPage();
      if (page) {
        await this._session.injectStealthScripts(page);
      }
    });

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
      () => this._takeover.getCursorStepCallback(),
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
    profileId:      string,
    profileClass:   ProfileClass,
    browserType:    BrowserType  = 'chromium',
    observeOptions?: ObserveSessionOptions,
  ): Promise<void> {
    this.behavioralDNA = this._session.generateBehavioralDNA(profileId);
    await this._session.launch(profileId, profileClass, this.settings, browserType, observeOptions);
    
    const page = this._session.getPlaywrightPage();
    if (page) {
      // headed:true activates the full agent overlay (cursor + glow + takeover button)
      await this._takeover.initialize(page as any, this.settings.headed);
    }
  }

  /**
   * Close the browser and finalise any active observe session.
   */
  async stop(): Promise<void> {
    await this._session.stop();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN TAKEOVER
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION & CORE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Navigate to a URL and return the resulting page state. */
  async navigate(url: string): Promise<TaloxPageState> {
    const state = await this._actions.navigate(
      url,
      this._session.isFirstNavigation,
      (v) => { this._session.isFirstNavigation = v; },
      this._session.lastState,
      this._session.rulesEngine,
    );
    this._session.lastState = state;
    await this._adapt.evaluate(state);
    return state;
  }

  /**
   * Collect and return the current page state without navigating.
   * Runs the rules engine over the result so `state.bugs` is populated.
   * Use this after `navigate()` when you need a fresh snapshot mid-test.
   */
  async getState(): Promise<TaloxPageState> {
    const state = await this._session.getActiveStateCollector().collect();
    state.bugs.push(...this._session.rulesEngine.analyze(state));
    this._session.lastState = state;
    return state;
  }

  /** Click an element by CSS selector. Self-heals on failure. */
  async click(selector: string): Promise<TaloxPageState> {
    const state = await this._actions.click(selector);
    await this._adapt.evaluate(state);
    return state;
  }

  /** Type text into an element by CSS selector. Self-heals on failure. */
  async type(selector: string, text: string): Promise<TaloxPageState> {
    return this._actions.type(selector, text);
  }

  /** Move the mouse to absolute viewport coordinates. */
  async mouseMove(x: number, y: number): Promise<void> {
    return this._actions.mouseMove(x, y);
  }

  /** Scroll an element into view. */
  async scrollTo(selector: string, align: 'start' | 'center' | 'end' | 'nearest' = 'center'): Promise<void> {
    return this._actions.scrollTo(selector, align);
  }

  /** Take a screenshot of the full page or a specific element. */
  async screenshot(options?: { selector?: string; path?: string }): Promise<Buffer | string> {
    return this._actions.screenshot(options);
  }

  /** Extract table data as JSON array. */
  async extractTable(selector: string): Promise<Array<Record<string, string>>> {
    return this._actions.extractTable(selector);
  }

  /** Find an element by text or accessible name. */
  async findElement(
    text: string,
    elementType?: 'button' | 'link' | 'input' | 'checkbox' | 'radio' | 'menuitem' | 'any',
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

  async waitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle', timeout = 30000): Promise<void> {
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

  setVerbosity(level: 0 | 1 | 2 | 3): void {
    this.settings.verbosity = level;
    this._events.emit('verbosityChanged', { level });
  }

  getVerbosity(): 0 | 1 | 2 | 3 {
    return this.settings.verbosity;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG SNAPSHOT
  // ═══════════════════════════════════════════════════════════════════════════

  async getDebugSnapshot(): Promise<DebugSnapshot> {
    const state = this._session.lastState;
    const snapshot: DebugSnapshot = {
      bugs: state?.bugs ?? [],
      consoleErrors: state?.console?.errors ?? [],
      networkErrors: state?.network?.failedRequests ?? [],
      lastAdaptation: (this._adapt as any).getLastAdaptation?.() ?? null,
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
  // HUMAN TAKEOVER STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Freeze the agent and hand control to the human.
   * The overlay switches from cyan to "Resume" state.
   * Resolves when the human clicks Resume or the timeout fires.
   */
  async requestHumanTakeover(reason?: string): Promise<void> {
    if (this.takeoverState === 'WAITING_FOR_HUMAN') return;

    return new Promise<void>((resolve) => {
      this._events.once('agentResumed', (_e) => resolve());

      this.takeoverState = 'WAITING_FOR_HUMAN';
      // TakeoverBridge listens to this event to update the overlay
      void this._takeover.requestTakeover(reason);

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
    if (this.takeoverState !== 'WAITING_FOR_HUMAN') return;

    if (this.autoResumeTimer) {
      clearTimeout(this.autoResumeTimer);
      this.autoResumeTimer = null;
    }

    this.takeoverState = 'AGENT_RUNNING';
    // TakeoverBridge listens to this event to restore the overlay
    this._takeover.resumeAgent();
  }

  getTakeoverState(): 'AGENT_RUNNING' | 'WAITING_FOR_HUMAN' {
    return this.takeoverState;
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
      jitterFrequency:   dna.jitterFrequency   ?? 0.5,
      accelerationCurve: dna.accelerationCurve ?? 'ease-out',
      typingRhythm:      dna.typingRhythm      ?? 'medium',
      clickPrecision:    dna.clickPrecision    ?? 0.75,
      movementStyle:     dna.movementStyle     ?? 'smooth',
    };
    this._session.artifactBuilder.addAction('setBehavioralDNA', { dna: this.behavioralDNA });
  }

  getBehavioralDNA(): any { return this.behavioralDNA; }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTENTION FRAME
  // ═══════════════════════════════════════════════════════════════════════════

  async setAttentionFrame(selector: string): Promise<{ x: number; y: number; width: number; height: number; selector?: string }> {
    const page = this._session.getPage();
    const element = await page.$(selector);
    if (!element) throw new Error(`Element not found for selector: ${selector}`);
    const box = await element.boundingBox();
    if (!box) throw new Error(`Unable to get bounding box for selector: ${selector}`);
    this.attentionFrame = { ...box, selector };
    this._session.artifactBuilder.addAction('setAttentionFrame', { selector, frame: this.attentionFrame });
    return this.attentionFrame!;
  }

  setAttentionFrameBox(x: number, y: number, width: number, height: number) {
    this.attentionFrame = { x, y, width, height };
    this._session.artifactBuilder.addAction('setAttentionFrameBox', { x, y, width, height });
    return this.attentionFrame;
  }

  clearAttentionFrame(): void {
    this.attentionFrame = null;
    this._session.artifactBuilder.addAction('clearAttentionFrame', {});
  }

  getAttentionFrame() { return this.attentionFrame; }

  isElementInFrame(elementBox: { x: number; y: number; width: number; height: number }): boolean {
    if (!this.attentionFrame) return true;
    const f = this.attentionFrame;
    const cx = elementBox.x + elementBox.width  / 2;
    const cy = elementBox.y + elementBox.height / 2;
    return cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height;
  }

  async getElementsInFrame(): Promise<TaloxNode[]> {
    if (!this.attentionFrame) throw new Error('No attention frame set.');
    const allNodes: TaloxNode[] = this._session.lastState?.nodes ?? [];
    return allNodes.filter(n => n.boundingBox && this.isElementInFrame(n.boundingBox));
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
      x:      this.attentionFrame.x + axX      * this.attentionFrame.width,
      y:      this.attentionFrame.y + axY      * this.attentionFrame.height,
      width:  axWidth  * this.attentionFrame.width,
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

  async openPage(url: string): Promise<TaloxPageState>       { return this._session.openPage(url); }
  async closePage(index: number): Promise<void>              { return this._session.closePage(index); }
  switchPage(index: number): void                             { return this._session.switchPage(index); }
  getPageCount(): number                                      { return this._session.getPageCount(); }
  getActivePageIndex(): number                                { return this._session.getActivePageIndex(); }
  getActivePage(): PageStateCollector | null                  { return this._session.getActivePage(); }
  getPlaywrightPage(): any                                    { return this._session.getPlaywrightPage(); }
  getAllPages(): PageStateCollector[]                         { return this._session.getAllPages(); }

  // ═══════════════════════════════════════════════════════════════════════════
  // VISUAL VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  async verifyVisual(baselineKey: string, autoSave = false): Promise<VisualDiffResult & { isMatch: boolean }> {
    return this._session.verifyVisual(baselineKey, autoSave);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADAPTIVE STEALTH
  // ═══════════════════════════════════════════════════════════════════════════

  setAdaptiveStealthEnabled(enabled: boolean): void         { this._actions.setAdaptiveStealthEnabled(enabled); }
  setAdaptiveStealthSensitivity(sensitivity: number): void  { this._actions.setAdaptiveStealthSensitivity(sensitivity); }
  setAdaptiveStealthRadius(radius: number): void            { this._actions.setAdaptiveStealthRadius(radius); }
  async calculateElementDensity(x: number, y: number)      { return this._actions.calculateElementDensity(x, y); }
  getAdaptiveMouseSpeed(density: number): number            { return this._actions.getAdaptiveMouseSpeed(density); }
  getAdaptiveJitter(density: number): number                { return this._actions.getAdaptiveJitter(density); }
  async getEffectiveMouseSpeed(x: number, y: number)        { return this._actions.getEffectiveMouseSpeed(x, y); }
  async getEffectiveJitter(x: number, y: number)            { return this._actions.getEffectiveJitter(x, y); }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRECISION DECAY
  // ═══════════════════════════════════════════════════════════════════════════

  getPrecisionOffset(): Point                { return this._actions.getPrecisionOffset(); }
  setPrecisionDecay(decay: number): void     { this._actions.setPrecisionDecay(decay); }
  getPrecisionDecay(): number                { return this._actions.getPrecisionDecay(); }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-THINKING
  // ═══════════════════════════════════════════════════════════════════════════

  startAutoThinking(): void                            { this._session.startAutoThinking(this.behavioralDNA); }
  stopAutoThinking(): void                             { this._session.stopAutoThinking(); }
  isAutoThinkingRunning(): boolean                     { return this._session.isAutoThinkingRunning(); }
  setAutomaticThinkingEnabled(enabled: boolean): void  { this.settings.automaticThinkingEnabled = enabled; }
  setIdleTimeout(timeoutMs: number): void              { this._session.setIdleTimeout(timeoutMs); }
  recordActivity(): void                               { this._session.recordActivity(); }
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

  setGlobalMouseTracking(enabled: boolean): void { this.useGlobalMousePos = enabled; }

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
  // SEMANTIC SEARCH HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  findNodeByText(text: string, fuzzy = false): TaloxNode | null {
    const nodes: TaloxNode[] = (this._session.getActiveStateCollector() as any).state?.nodes ?? [];
    const norm = fuzzy ? text.toLowerCase() : text;
    return nodes.find(n => {
      const t = fuzzy ? (n.name ?? '').toLowerCase() : (n.name ?? '');
      return fuzzy ? t.includes(norm) : t === norm;
    }) ?? null;
  }

  findNodesByText(text: string, fuzzy = false): TaloxNode[] {
    const nodes: TaloxNode[] = (this._session.getActiveStateCollector() as any).state?.nodes ?? [];
    const norm = fuzzy ? text.toLowerCase() : text;
    return nodes.filter(n => {
      const t = fuzzy ? (n.name ?? '').toLowerCase() : (n.name ?? '');
      return fuzzy ? t.includes(norm) : t === norm;
    });
  }

  findNodeByRole(role: string): TaloxNode | null {
    const nodes: TaloxNode[] = (this._session.getActiveStateCollector() as any).state?.nodes ?? [];
    const r = role.toLowerCase();
    return nodes.find(n => (n.role ?? '').toLowerCase() === r) ?? null;
  }

  findNodesByRole(roles: string[]): TaloxNode[] {
    const nodes: TaloxNode[] = (this._session.getActiveStateCollector() as any).state?.nodes ?? [];
    const rs = roles.map(r => r.toLowerCase());
    return nodes.filter(n => rs.includes((n.role ?? '').toLowerCase()));
  }

  findInteractiveNodes(): TaloxNode[] {
    return this.findNodesByRole([
      'button','link','textbox','checkbox','radio','combobox',
      'menu','menuitem','tab','slider','switch','searchbox','input','textarea','anchor',
    ]);
  }

  compressStateForLLM(state: TaloxPageState): any {
    const interactive = new Set([
      'button','link','textbox','checkbox','radio','combobox',
      'menu','menuitem','tab','slider','switch','searchbox','input','listbox','option',
    ]);
    const pruned = state.nodes.filter(n => {
      const role = (n.role ?? '').toLowerCase();
      if (interactive.has(role)) return true;
      if (role === 'statictext' || role === 'text') return (n.name ?? '').trim().length > 0;
      if (role === 'heading') return true;
      return false;
    });
    return {
      url:   state.url,
      title: state.title,
      nodes: pruned.map(n => ({ role: n.role, name: n.name, value: n.attributes?.['value'], id: n.id })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGE DESCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════

  async describePage(): Promise<string> {
    const state = this._session.lastState;
    if (!state) return 'No page loaded yet. Call navigate() first.';

    const { SemanticMapper } = await import('../SemanticMapper.js');
    const mapper   = new SemanticMapper();
    const entities = mapper.mapNodes(state.nodes, state.url);
    const inter    = mapper.filterInteractive(entities);
    const grouped  = mapper.groupByType(inter);

    const parts: string[] = [`Page: "${state.title}" at ${state.url}`];
    const forms   = grouped.get('form');
    if (forms?.length)    parts.push(`Contains ${forms.length} form(s).`);
    const inputs  = grouped.get('input');
    if (inputs?.length)   parts.push(`Input fields: ${inputs.slice(0,5).map(e => e.label).join(', ')}`);
    const buttons = grouped.get('button');
    if (buttons?.length)  parts.push(`Buttons: ${buttons.slice(0,5).map(e => e.label).join(', ')}`);
    const links   = grouped.get('link');
    if (links?.length)    parts.push(`Links: ${links.length} link(s) on page`);
    if (state.console.errors.length) parts.push(`Console errors: ${state.console.errors.length}`);
    if (state.bugs.length)           parts.push(`Detected ${state.bugs.length} bug(s)`);
    return parts.join(' ');
  }

  async getIntentState() {
    const state = this._session.lastState;
    if (!state) return { pageType: 'unknown', primaryAction: null, inputs: [], errors: [], bugs: [] };

    const { SemanticMapper } = await import('../SemanticMapper.js');
    const mapper   = new SemanticMapper();
    const entities = mapper.mapNodes(state.nodes, state.url);
    const inter    = mapper.filterInteractive(entities);
    const sorted   = mapper.sortByPosition(inter);

    const url = state.url.toLowerCase();
    let pageType = 'unknown';
    if (/login|signin/.test(url))          pageType = 'login';
    else if (/checkout|cart/.test(url))    pageType = 'checkout';
    else if (/search|results/.test(url))   pageType = 'search';
    else if (/product|item/.test(url))     pageType = 'product';
    else if (/article|post|blog/.test(url))pageType = 'article';
    else if (inter.some(e => e.type === 'form')) pageType = 'form';

    return {
      pageType,
      primaryAction: sorted[0] ? { type: sorted[0].type, label: sorted[0].label, selector: sorted[0].id } : null,
      inputs: inter.filter(e => e.type === 'input' || e.type === 'search').slice(0, 10).map(e => ({ label: e.label, type: e.role, id: e.id })),
      errors: state.console.errors,
      bugs:   state.bugs.map(b => ({ type: b.type, severity: b.severity })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUMAN-IN-THE-LOOP HOOK
  // ═══════════════════════════════════════════════════════════════════════════

  setOnRiskyActionHook(hook: (action: string, target: string) => Promise<boolean>): void {
    (this._actions as any).riskyActionHook = hook;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTS — legacy-compatible API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to a Talox event.
   *
   * @example
   * ```ts
   * talox.on('sessionEnd', (e) => console.log(e.reportPath));
   * talox.on('adapted',    (e) => console.log(e.reason));
   * ```
   */
  on<K extends keyof TaloxEventMap>(
    eventType: K,
    handler: (data: TaloxEventMap[K]) => void,
  ): void {
    this._events.on(eventType, handler as any);
  }

  off<K extends keyof TaloxEventMap>(
    eventType: K,
    handler: (data: TaloxEventMap[K]) => void,
  ): void {
    this._events.off(eventType, handler as any);
  }

  removeAllListeners(): void {
    this._events.removeAllListeners();
  }

  getEventListeners(): Map<TaloxEventType, number> {
    return this._events.getListenerCounts() as Map<TaloxEventType, number>;
  }
}
