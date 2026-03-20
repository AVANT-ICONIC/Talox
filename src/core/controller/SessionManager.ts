/**
 * @file SessionManager.ts
 * @description Session lifecycle, browser launch, multi-page management,
 * and auto-thinking idle behavior for TaloxController.
 */

// ─── Re-exported types ────────────────────────────────────────────────────────
/** Viewport-relative scoping frame for perception and interaction. */
export interface AttentionFrame {
  x:        number;
  y:        number;
  width:    number;
  height:   number;
  selector?: string;
}

import type { TaloxPageState, TaloxProfile, ProfileClass, Point } from '../../types/index.js';
import type { TaloxEventMap } from '../../types/events.js';
import type { ObserveSessionOptions } from '../../types/session.js';
import type { TaloxSettings } from '../../types/settings.js';
import type { EventBus } from './EventBus.js';
import { BrowserManager, type BrowserType } from '../BrowserManager.js';
import { ProfileVault } from '../ProfileVault.js';
import { PageStateCollector } from '../PageStateCollector.js';
import { RulesEngine } from '../RulesEngine.js';
import { ArtifactBuilder } from '../ArtifactBuilder.js';
import { VisionGate } from '../VisionGate.js';
import { PolicyEngine } from '../PolicyEngine.js';
import { HumanMouse } from '../HumanMouse.js';
import { ObserveSession } from '../observe/ObserveSession.js';

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

  private selectedUserAgent: string | null = null;
  private webglInfo: { vendor: string; renderer: string } | null = null;

  private readonly userAgents: string[] = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ];

  private readonly webglRenderers = [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Apple Inc.', renderer: 'Apple M1' },
    { vendor: 'Apple Inc.', renderer: 'Apple M2' },
  ];

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
    browserType: BrowserType = 'chromium',
    observeOptions?: ObserveSessionOptions,
  ): Promise<void> {
    this.profile = await this.profileVault.createProfile(profileId, profileClass, 'Agent Session');
    const behavioralDNA = this.generateBehavioralDNA(profileId);

    const resolvedOpts: ObserveSessionOptions = { ...observeOptions };
    const wantsHeaded = resolvedOpts.headed ?? this.settings.headed;

    let launchOptions: any = {};
    if (wantsHeaded) {
      launchOptions.headless = false;
    }

    const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    const webgl = this.webglRenderers[Math.floor(Math.random() * this.webglRenderers.length)];

    this.selectedUserAgent = ua ?? this.userAgents[0] ?? null;
    this.webglInfo = webgl ?? this.webglRenderers[0] ?? null;

    const width = 1280 + Math.floor(Math.random() * (1920 - 1280));
    const height = 720 + Math.floor(Math.random() * (1080 - 720));

    if (this.selectedUserAgent) {
      launchOptions.userAgent = this.selectedUserAgent;
      console.log(`Launch: UA=${this.selectedUserAgent.slice(0, 30)}..., Viewport=${width}x${height}`);
    }

    launchOptions.viewport = { width, height };

    const context = await this.browserManager.launch(this.profile, this.settings.headed, browserType, launchOptions);
    const page = await context.newPage();

    await this.injectStealthScripts(page);

    await this.attachSecurityHooks(page);

    const stateCollector = new PageStateCollector(page);
    this.activePageIndex = 0;
    this.pages = [stateCollector];
    this.pageMousePositions.set(0, { x: 0, y: 0 });
    this.artifactBuilder.addAction('launch', { profileId, profileClass, browserType, launchOptions });

    const needsSession = resolvedOpts.overlay === true || resolvedOpts.record === true;

    if (needsSession) {
      this.observeSession = new ObserveSession(page, context, this.events, resolvedOpts);
      await this.observeSession.start();
    }

    this.startAutoThinking(behavioralDNA);
  }

  // ─── Stop ────────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    this.stopAutoThinking();
    await this.browserManager.close();

    if (this.observeSession) {
      await this.observeSession.endSession();
      this.observeSession = null;
    }
  }

  // ─── Headed Mode ─────────────────────────────────────────────────────────────

  async setHeadedMode(headed: boolean): Promise<void> {
    const context = this.browserManager.getContext();
    if (!context) return;
    
    const page = this.getPage();
    if (!page) return;

    if (headed) {
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = 'body { background: #1a1a2e; }';
        document.head.appendChild(style);
      });
    }
  }

  // ─── Freeze/Unfreeze for Human Takeover ───────────────────────────────────────

  private isFrozen: boolean = false;

  freeze(): void {
    this.isFrozen = true;
    this.stopAutoThinking();
    this.artifactBuilder.addAction('freeze', { timestamp: new Date().toISOString() });
  }

  unfreeze(): void {
    this.isFrozen = false;
    this.artifactBuilder.addAction('unfreeze', { timestamp: new Date().toISOString() });
  }

  // ─── Multi-Page ──────────────────────────────────────────────────────────────

  async openPage(url: string): Promise<TaloxPageState> {
    const page = await this.browserManager.newPage();

    await this.injectStealthScripts(page);

    await this.attachSecurityHooks(page);

    const stateCollector = new PageStateCollector(page);
    this.activePageIndex = this.pages.length;
    this.pages.push(stateCollector);
    this.pageMousePositions.set(this.activePageIndex, { x: 0, y: 0 });
    this.artifactBuilder.addAction('openPage', { url, pageIndex: this.activePageIndex });

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

    const page = (this.pages[index] as any).page as any;
    await page.close();

    this.pages.splice(index, 1);
    this.pageMousePositions.delete(index);

    if (this.activePageIndex === index) {
      this.activePageIndex = this.pages.length > 0 ? 0 : -1;
    } else if (this.activePageIndex > index) {
      this.activePageIndex--;
    }

    this.artifactBuilder.addAction('closePage', { index });
  }

  switchPage(index: number): void {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`Invalid page index: ${index}`);
    }
    this.activePageIndex = index;
    this.artifactBuilder.addAction('switchPage', { index });
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
      throw new Error('No active page. Use launch() or openPage() first.');
    }
    return (this.pages[this.activePageIndex] as any).page;
  }

  getActiveStateCollector(): PageStateCollector {
    const page = this.pages[this.activePageIndex];
    if (!page) {
      throw new Error('No active page. Use launch() or openPage() first.');
    }
    return page;
  }

  // ─── Visual Verification ─────────────────────────────────────────────────────

  async verifyVisual(baselineKey: string, autoSave: boolean = false): Promise<any> {
    const page = this.getPage();
    const screenshot = await page.screenshot();

    let baseline = await this.visionGate.getBaseline(baselineKey);

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
      isMatch: diff.mismatchedPixels < 50 && diff.ssimScore > 0.98
    };
  }

  // ─── Auto-Thinking ───────────────────────────────────────────────────────────

  startAutoThinking(behavioralDNA: any): void {
    const settings = this.settings;

    if (!settings.automaticThinkingEnabled) {
      this.artifactBuilder.addAction('startAutoThinking', { reason: 'disabled' });
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
      this.checkIdleAndThink(lastPos, attentionFrame, (x, y) => ({ x, y }));
    }, 1000);

    this.artifactBuilder.addAction('startAutoThinking', {
      idleTimeout: settings.idleTimeout,
      mode: 'smart'
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
    this.artifactBuilder.addAction('stopAutoThinking', {});
  }

  isAutoThinkingRunning(): boolean {
    return this.isAutoThinkingActive;
  }

  setAutomaticThinkingEnabled(enabled: boolean): void {
    this.settings.automaticThinkingEnabled = enabled;
    this.artifactBuilder.addAction('setAutomaticThinkingEnabled', { enabled });
  }

  setIdleTimeout(timeoutMs: number): void {
    const clamped = Math.max(1000, Math.min(60000, timeoutMs));
    this.settings.idleTimeout = clamped;
    this.artifactBuilder.addAction('setIdleTimeout', { idleTimeout: clamped });
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
      await this.performMicroJitter(this.getPage(), lastMousePos, (p) => { /* caller updates */ });
    } else if (behaviorType < 0.7) {
      await this.performSmallCursorMovement(this.getPage(), lastMousePos, attentionFrame, clampToFrame, (p) => { /* caller updates */ });
    } else {
      await this.performMicroScroll(this.getPage());
    }

    this.lastActivityTimestamp = Date.now();
    this.artifactBuilder.addAction('triggerThinkingBehavior', { behaviorType });
  }

  recordActivity(): void {
    this.lastActivityTimestamp = Date.now();
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

  async performMicroJitter(
    page: any,
    lastMousePos: Point,
    setLastMousePos: (p: Point) => void,
  ): Promise<void> {
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
    if (!this.profile || this.profile.class === 'sandbox') return;

    // 1. Outbound Request Guard
    await page.route('**/*', (route: any) => {
      const request = route.request();
      const method = request.method();
      const url = request.url();

      if ((method === 'POST' || method === 'PUT') && this.profile?.class === 'ops') {
        const postData = request.postData() || '';
        const credentialRegex = /(eyJhbGciOiJIUzI1Ni|sk_live_|ghp_)/i;

        if (credentialRegex.test(postData) || credentialRegex.test(url)) {
          console.error(`🛡️ SECURITY GUARD BLOCKED REQUEST: Potential credential leak to ${url}`);
          return route.abort('accessdenied');
        }
      }
      route.continue();
    });

    // 2. Per-Tab Behavior Monitoring (Popup Storms / Dialogs)
    let dialogCount = 0;
    page.on('dialog', async (dialog: any) => {
      dialogCount++;
      if (dialogCount > 3 && this.profile?.class === 'ops') {
        console.warn('🛡️ SECURITY GUARD: Unexpected dialog storm detected. Auto-dismissing.');
        await dialog.dismiss();
      } else {
        await dialog.dismiss();
      }
    });

    page.on('popup', (popup: any) => {
      console.warn(`🛡️ SECURITY GUARD: Unexpected popup opened: ${popup.url()}`);
      if (this.profile?.class === 'ops') {
        popup.close().catch(() => {});
      }
    });

    // 3. Runtime Script Analysis (Heuristic-based)
    if (this.profile?.class === 'ops') {
      page.on('response', async (response: any) => {
        const url = response.url();
        const type = response.request().resourceType();
        if (type === 'script' || type === 'fetch' || type === 'xhr') {
          if (url.includes('exfil') || url.includes('tracker') || url.includes('fingerprint')) {
            console.warn(`🛡️ SECURITY GUARD: Suspicious script loaded: ${url}`);
          }
        }
      });
    }
  }

  async injectStealthScripts(page: any): Promise<void> {
    const webgl = this.webglInfo || this.webglRenderers[0];

    await page.addInitScript((data: any) => {
      // 1. Navigator Webdriver Evasion
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // 2. Chrome Runtime Spoofing
      // @ts-ignore
      window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
      };

      // 3. Plugin Spoofing
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Google Chrome PDF Viewer' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Chromium PDF Viewer' },
          { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Microsoft Edge PDF Viewer' },
          { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'WebKit built-in PDF Viewer' }
        ],
      });

      // 4. Language Spoofing
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // 5. Canvas Fingerprint Protection (Adds subtle noise)
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, encoderOptions) {
        const context = this.getContext('2d');
        if (context) {
          try {
            const imageData = context.getImageData(0, 0, this.width, this.height);
            if (imageData && imageData.data && imageData.data.length > 0) {
              const lastIdx = imageData.data.length - 1;
              const val = imageData.data[lastIdx];
              if (val !== undefined) {
                imageData.data[lastIdx] = (val + 1) % 255;
                context.putImageData(imageData, 0, 0);
              }
            }
          } catch (e) {
            // Ignore canvas errors
          }
        }
        return originalToDataURL.apply(this, [type, encoderOptions]);
      };

      // 6. WebGL Vendor/Renderer Spoofing
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) return data.vendor;
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) return data.renderer;
        return getParameter.apply(this, [parameter]);
      };

      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return data.vendor;
        if (parameter === 37446) return data.renderer;
        return getParameter2.apply(this, [parameter]);
      };
    }, webgl);
  }

  // ─── Behavioral DNA ───────────────────────────────────────────────────────────

  generateBehavioralDNA(profileId: string): any {
    const hash = this.hashString(profileId);
    const normalizedHash = hash / 0xFFFFFFFF;

    const movementStyles = ['smooth', 'jerky', 'precise', 'relaxed'] as const;
    const typingRhythms = ['fast', 'medium', 'slow', 'variable'] as const;
    const accelerationCurves = ['linear', 'ease-out', 'ease-in-out', 'bezier'] as const;

    const dna = {
      jitterFrequency: 0.1 + (normalizedHash * 0.9),
      accelerationCurve: accelerationCurves[Math.floor(normalizedHash * accelerationCurves.length) % accelerationCurves.length],
      typingRhythm: typingRhythms[Math.floor((normalizedHash * 10) % typingRhythms.length) % typingRhythms.length],
      clickPrecision: 0.5 + (normalizedHash * 0.5),
      movementStyle: movementStyles[Math.floor(normalizedHash * movementStyles.length) % movementStyles.length],
    };

    this.artifactBuilder.addAction('generateBehavioralDNA', { profileId, dna });
    return dna;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
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
