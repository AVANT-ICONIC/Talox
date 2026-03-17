import { BrowserManager, type BrowserType } from './BrowserManager.js';
import { ProfileVault } from './ProfileVault.js';
import { PageStateCollector } from './PageStateCollector.js';
import { RulesEngine } from './RulesEngine.js';
import { ArtifactBuilder } from './ArtifactBuilder.js';
import { HumanMouse } from './HumanMouse.js';
import { PolicyEngine } from './PolicyEngine.js';
import { VisionGate } from './VisionGate.js';
import type { TaloxProfile, TaloxPageState, ProfileClass, TaloxMode, Point, VisualDiffResult, TaloxSettings, TaloxNode } from '../types/index.js';

export interface AttentionFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  selector?: string;
}

export type MovementStyle = 'smooth' | 'jerky' | 'precise' | 'relaxed';
export type TypingRhythm = 'fast' | 'medium' | 'slow' | 'variable';
export type AccelerationCurve = 'linear' | 'ease-out' | 'ease-in-out' | 'bezier';

export interface BehavioralDNA {
  jitterFrequency: number;
  accelerationCurve: AccelerationCurve;
  typingRhythm: TypingRhythm;
  clickPrecision: number;
  movementStyle: MovementStyle;
}

export class TaloxController {
  private browserManager: BrowserManager;
  private profileVault: ProfileVault;
  private pages: PageStateCollector[] = [];
  private activePageIndex: number = -1;
  private pageMousePositions: Map<number, Point> = new Map();
  private rulesEngine: RulesEngine;
  private artifactBuilder: ArtifactBuilder;
  private policyEngine: PolicyEngine;
  private visionGate: VisionGate;
  private profile: TaloxProfile | null = null;
  private mode: TaloxMode = 'browse';
  private globalLastMousePos: Point = { x: 0, y: 0 };
  private lastState: TaloxPageState | null = null;
  private useGlobalMousePos: boolean = true;
  private attentionFrame: AttentionFrame | null = null;
  private viewportScale: number = 1.0;
  private behavioralDNA: BehavioralDNA | null = null;
  
  private settings: TaloxSettings = {
    mouseSpeed: 1.0,
    typingDelayMin: 50,
    typingDelayMax: 150,
    stealthLevel: 'medium',
    perceptionDepth: 'full',
    fidgetEnabled: true,
    humanStealth: 0.5,
    typoProbability: 0.08,
    adaptiveStealthEnabled: false,
    adaptiveStealthSensitivity: 1.0,
    adaptiveStealthRadius: 150,
    precisionDecay: 0.0,
    automaticThinkingEnabled: false,
    idleTimeout: 5000
  };

  private autoThinkingInterval: NodeJS.Timeout | null = null;
  private autoThinkingCheckInterval: NodeJS.Timeout | null = null;
  private lastActivityTimestamp: number = 0;
  private isAutoThinkingActive: boolean = false;

  /**
   * 🎛️ MODE PRESETS
   * 
   * SPEED MODE: Absolute maximum throughput. 
   * - Bypasses ALL HumanMouse logic (direct Playwright calls)
   * - No human-like delays, curves, jitter, or Fitts's Law calculations
   * - Minimal overhead for fastest possible interactions
   * - Use for: High-volume automation, scraping, performance testing
   * 
   * STEALTH MODE: Maximum biomechanical protection.
   * - Uses ALL human-like features: Fitts's Law, curves, jitter, randomized delays
   * - Adaptive stealth enabled by default
   * - Typo simulation enabled
   * - Maximum humanStealth (0.9)
   * - Use for: Anti-detection, human behavior simulation
   * 
   * DEBUG MODE: Maximum data density.
   * - Verbose console/network capture enabled
   * - Full AX-Tree snapshots for development
   * - Maximum perception depth for detailed analysis
   * - Human-like timing to observe behavior
   * - Use for: Development, debugging, test verification
   * 
   * BALANCED MODE: Default behavior.
   * - Mix of speed and human-like features
   * - Moderate stealth settings
   * 
   * BROWSE MODE: Human-like browsing.
   * - Full human mouse simulation
   * - Typo simulation
   * - Adaptive stealth support
   * 
   * HYBRID MODE: Mix of human and automated.
   * - Some human features with faster timing
   * 
   * QA MODE: Testing/verification focused.
   * - Faster than balanced, some human features
   * - Full perception depth
   */
  private presets: Record<string, Partial<TaloxSettings>> = {
    'speed': { 
      mouseSpeed: 3.0, 
      stealthLevel: 'low', 
      fidgetEnabled: false, 
      humanStealth: 0, 
      typoProbability: 0, 
      precisionDecay: 0,
      adaptiveStealthEnabled: false,
      automaticThinkingEnabled: false
    },
    'stealth': { 
      mouseSpeed: 0.7, 
      stealthLevel: 'high', 
      fidgetEnabled: true, 
      humanStealth: 1.0, 
      typingDelayMin: 100, 
      typingDelayMax: 300, 
      typoProbability: 0.1, 
      precisionDecay: 0,
      adaptiveStealthEnabled: true,
      automaticThinkingEnabled: true
    },
    'debug': {
      mouseSpeed: 1.0,
      stealthLevel: 'medium',
      fidgetEnabled: false,
      humanStealth: 0.5,
      typingDelayMin: 75,
      typingDelayMax: 200,
      typoProbability: 0.05,
      precisionDecay: 0,
      adaptiveStealthEnabled: false,
      perceptionDepth: 'full',
      automaticThinkingEnabled: false
    },
    'balanced': { mouseSpeed: 1.0, stealthLevel: 'medium', fidgetEnabled: true, humanStealth: 0.5, typoProbability: 0.08, precisionDecay: 0, automaticThinkingEnabled: true },
    'browse': { mouseSpeed: 1.0, stealthLevel: 'medium', fidgetEnabled: true, humanStealth: 0.5, typoProbability: 0.08, precisionDecay: 0, automaticThinkingEnabled: true },
    'qa': { mouseSpeed: 1.5, stealthLevel: 'low', fidgetEnabled: false, humanStealth: 0.2, perceptionDepth: 'full', typoProbability: 0, precisionDecay: 0.15 }
  };

  private keyboardNeighbors: Map<string, string[]> = new Map([
    ['q', ['w', 'a', 's']], ['w', ['q', 'e', 'a', 's', 'd']], ['e', ['w', 'r', 's', 'd', 'f']], ['r', ['e', 't', 'd', 'f', 'g']], ['t', ['r', 'y', 'f', 'g', 'h']], ['y', ['t', 'u', 'g', 'h', 'j']], ['u', ['y', 'i', 'h', 'j', 'k']], ['i', ['u', 'o', 'j', 'k', 'l']], ['o', ['i', 'p', 'k', 'l']], ['p', ['o', 'l']],
    ['a', ['q', 'w', 's', 'z', 'x']], ['s', ['w', 'e', 'd', 'x', 'z', 'a']], ['d', ['e', 'r', 'f', 'c', 'x', 's']], ['f', ['r', 't', 'g', 'v', 'c', 'd']], ['g', ['t', 'y', 'h', 'b', 'v', 'f']], ['h', ['y', 'u', 'j', 'n', 'b', 'g']], ['j', ['u', 'i', 'k', 'm', 'n', 'h']], ['k', ['i', 'o', 'l', 'm', 'j']], ['l', ['o', 'p', 'k']],
    ['z', ['a', 's', 'x']], ['x', ['s', 'd', 'c', 'z']], ['c', ['d', 'f', 'v', 'x']], ['v', ['f', 'g', 'b', 'c']], ['b', ['g', 'h', 'n', 'v']], ['n', ['h', 'j', 'm', 'b']], ['m', ['j', 'k', 'n']],
    ['1', ['2', 'q']], ['2', ['1', '3', 'q', 'w']], ['3', ['2', '4', 'w', 'e']], ['4', ['3', '5', 'e', 'r']], ['5', ['4', '6', 'r', 't']], ['6', ['5', '7', 't', 'y']], ['7', ['6', '8', 'y', 'u']], ['8', ['7', '9', 'u', 'i']], ['9', ['8', '0', 'i', 'o']], ['0', ['9', 'o', 'p']],
    [' ', ['v', 'b', 'n', 'm']]
  ]);

  constructor(baseDir: string) {
    this.browserManager = new BrowserManager();
    this.profileVault = new ProfileVault(baseDir);
    this.rulesEngine = new RulesEngine();
    this.artifactBuilder = new ArtifactBuilder();
    this.policyEngine = new PolicyEngine();
    this.visionGate = new VisionGate();
  }

  /**
   * 🧬 BEHAVIORAL DNA: Generate unique deterministic parameters from profile ID
   */
  generateBehavioralDNA(profileId: string): BehavioralDNA {
    const hash = this.hashString(profileId);
    const normalizedHash = hash / 0xFFFFFFFF;
    
    const movementStyles: MovementStyle[] = ['smooth', 'jerky', 'precise', 'relaxed'];
    const typingRhythms: TypingRhythm[] = ['fast', 'medium', 'slow', 'variable'];
    const accelerationCurves: AccelerationCurve[] = ['linear', 'ease-out', 'ease-in-out', 'bezier'];
    
    this.behavioralDNA = {
      jitterFrequency: 0.1 + (normalizedHash * 0.9),
      accelerationCurve: accelerationCurves[Math.floor(normalizedHash * accelerationCurves.length) % accelerationCurves.length] as AccelerationCurve,
      typingRhythm: typingRhythms[Math.floor((normalizedHash * 10) % typingRhythms.length) % typingRhythms.length] as TypingRhythm,
      clickPrecision: 0.5 + (normalizedHash * 0.5),
      movementStyle: movementStyles[Math.floor(normalizedHash * movementStyles.length) % movementStyles.length] as MovementStyle
    };
    
    this.artifactBuilder.addAction('generateBehavioralDNA', { profileId, dna: this.behavioralDNA });
    return this.behavioralDNA!;
  }

  /**
   * 🧬 BEHAVIORAL DNA: Override generated DNA with custom parameters
   */
  setBehavioralDNA(dna: Partial<BehavioralDNA>): void {
    this.behavioralDNA = {
      jitterFrequency: dna.jitterFrequency ?? 0.5,
      accelerationCurve: dna.accelerationCurve ?? 'ease-out',
      typingRhythm: dna.typingRhythm ?? 'medium',
      clickPrecision: dna.clickPrecision ?? 0.75,
      movementStyle: dna.movementStyle ?? 'smooth'
    };
    this.artifactBuilder.addAction('setBehavioralDNA', { dna: this.behavioralDNA });
  }

  /**
   * 🧬 BEHAVIORAL DNA: Get current DNA parameters
   */
  getBehavioralDNA(): BehavioralDNA | null {
    return this.behavioralDNA;
  }

  /**
   * 🧬 BEHAVIORAL DNA: Get DNA-influenced mouse speed modifier
   */
  private getDNAMouseSpeed(): number {
    if (!this.behavioralDNA) return 1.0;
    const styleFactor = this.behavioralDNA.movementStyle === 'precise' ? 0.8 : 
                        this.behavioralDNA.movementStyle === 'relaxed' ? 1.2 : 1.0;
    return this.settings.mouseSpeed * styleFactor;
  }

  /**
   * 🧬 BEHAVIORAL DNA: Get DNA-influenced jitter amount
   */
  private getDNAJitter(): number {
    if (!this.behavioralDNA) return 0;
    return this.behavioralDNA.jitterFrequency * 20;
  }

  /**
   * 🧬 BEHAVIORAL DNA: Get DNA-influenced typing delay
   */
  private getDNATypingDelay(): { min: number; max: number } {
    if (!this.behavioralDNA) {
      return { min: this.settings.typingDelayMin, max: this.settings.typingDelayMax };
    }
    const rhythm = this.behavioralDNA.typingRhythm;
    const baseMin = this.settings.typingDelayMin;
    const baseMax = this.settings.typingDelayMax;
    
    switch (rhythm) {
      case 'fast':
        return { min: baseMin * 0.5, max: baseMax * 0.5 };
      case 'slow':
        return { min: baseMin * 1.5, max: baseMax * 1.5 };
      case 'variable':
        return { min: baseMin * 0.3, max: baseMax * 2.0 };
      case 'medium':
      default:
        return { min: baseMin, max: baseMax };
    }
  }

  /**
   * 🧬 BEHAVIORAL DNA: Simple hash function for deterministic DNA generation
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * 🎛️ MODE: Switch between predefined presets.
   */
  setMode(mode: TaloxMode) {
    this.mode = mode;
    const preset = this.presets[mode];
    if (preset) {
        this.updateSettings(preset);
    }
    this.artifactBuilder.addAction('setMode', { mode });
  }

  /**
   * 🎛️ MODE: Get the current operating mode.
   * @returns Current TaloxMode ('speed', 'stealth', 'debug', 'balanced', 'browse', 'hybrid', 'qa')
   */
  getMode(): TaloxMode {
    return this.mode;
  }

  /**
   * 🔧 OVERRIDE: Granular override for any behavioral parameter.
   */
  override(param: keyof TaloxSettings | string, value: any) {
    if (param === 'mouseSpeed' && typeof value === 'string') {
        const speedMap: Record<string, number> = { 'slow': 0.5, 'normal': 1.0, 'fast': 2.0 };
        value = speedMap[value] || 1.0;
    }
    this.updateSettings({ [param]: value });
  }

  /**
   * 🎛️ SETTINGS: Update behavioral parameters at runtime.
   */
  updateSettings(newSettings: Partial<TaloxSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    this.artifactBuilder.addAction('updateSettings', newSettings);
  }

  private getPage() {
    if (this.activePageIndex < 0 || this.activePageIndex >= this.pages.length) {
      throw new Error('No active page. Use launch() or openPage() first.');
    }
    return (this.pages[this.activePageIndex] as any).page;
  }

  private getActiveStateCollector(): PageStateCollector {
    const page = this.pages[this.activePageIndex];
    if (!page) {
      throw new Error('No active page. Use launch() or openPage() first.');
    }
    return page;
  }

  private getCurrentLastMousePos(): Point {
    if (this.useGlobalMousePos) {
      return this.globalLastMousePos;
    }
    return this.pageMousePositions.get(this.activePageIndex) || { x: 0, y: 0 };
  }

  private setCurrentLastMousePos(pos: Point): void {
    if (this.useGlobalMousePos) {
      this.globalLastMousePos = pos;
    } else {
      this.pageMousePositions.set(this.activePageIndex, pos);
    }
  }

  setGlobalMouseTracking(enabled: boolean): void {
    this.useGlobalMousePos = enabled;
  }

  /**
   * 🎯 ATTENTION FRAME: Set the attention frame using a CSS selector.
   * This scopes all perception and interaction logic to a specific sub-region.
   */
  async setAttentionFrame(selector: string): Promise<AttentionFrame> {
    const page = this.getPage();
    
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found for selector: ${selector}`);
    }

    const box = await element.boundingBox();
    if (!box) {
      throw new Error(`Unable to get bounding box for selector: ${selector}`);
    }

    const viewport = page.viewport();
    if (viewport) {
      this.viewportScale = viewport.width > 0 ? viewport.width / viewport.width : 1.0;
    }

    this.attentionFrame = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      selector
    };

    this.artifactBuilder.addAction('setAttentionFrame', { selector, frame: this.attentionFrame });
    return this.attentionFrame;
  }

  /**
   * 🎯 ATTENTION FRAME: Set the attention frame using direct box coordinates.
   * Coordinates are relative to the viewport.
   */
  setAttentionFrameBox(x: number, y: number, width: number, height: number): AttentionFrame {
    this.attentionFrame = {
      x,
      y,
      width,
      height
    };

    this.artifactBuilder.addAction('setAttentionFrameBox', { x, y, width, height });
    return this.attentionFrame;
  }

  /**
   * 🎯 ATTENTION FRAME: Clear the attention frame.
   * Reverts to full viewport perception.
   */
  clearAttentionFrame(): void {
    this.attentionFrame = null;
    this.artifactBuilder.addAction('clearAttentionFrame', {});
  }

  /**
   * 🎯 ATTENTION FRAME: Get the current attention frame.
   */
  getAttentionFrame(): AttentionFrame | null {
    return this.attentionFrame;
  }

  /**
   * 🎯 ATTENTION FRAME: Check if an element is within the attention frame.
   */
  isElementInFrame(elementBox: { x: number; y: number; width: number; height: number }): boolean {
    if (!this.attentionFrame) {
      return true;
    }

    const frame = this.attentionFrame;
    const elemCenterX = elementBox.x + elementBox.width / 2;
    const elemCenterY = elementBox.y + elementBox.height / 2;

    return (
      elemCenterX >= frame.x &&
      elemCenterX <= frame.x + frame.width &&
      elemCenterY >= frame.y &&
      elemCenterY <= frame.y + frame.height
    );
  }

  /**
   * 🎯 ATTENTION FRAME: Get elements that are within the attention frame.
   */
  async getElementsInFrame(): Promise<TaloxNode[]> {
    if (!this.attentionFrame) {
      throw new Error('No attention frame set. Call setAttentionFrame() first.');
    }

    const state = this.getActiveStateCollector();
    const allNodes = (state as any).state?.nodes || [];
    
    return allNodes.filter((node: TaloxNode) => {
      if (!node.boundingBox) return false;
      return this.isElementInFrame(node.boundingBox);
    });
  }

  /**
   * 🎯 ATTENTION FRAME: Find the best element matching selector within the attention frame.
   * If no attention frame is set, falls back to standard selection.
   */
  async findElementInFrame(selector: string): Promise<{ element: any; box: { x: number; y: number; width: number; height: number } } | null> {
    const page = this.getPage();
    
    const elements = await page.$$(selector);
    if (elements.length === 0) {
      return null;
    }

    for (const element of elements) {
      const box = await element.boundingBox();
      if (box && this.isElementInFrame(box)) {
        return { element, box };
      }
    }

    if (!this.attentionFrame) {
      const box = await elements[0].boundingBox();
      if (box) {
        return { element: elements[0], box };
      }
    }

    return null;
  }

  /**
   * 🎯 ATTENTION FRAME: Scale coordinates from AX-Tree to viewport-relative.
   * Fixes coordinate scaling mismatches between AX-Tree bounding boxes and viewport.
   */
  scaleAXToViewport(axX: number, axY: number, axWidth: number, axHeight: number): { x: number; y: number; width: number; height: number } {
    if (!this.attentionFrame) {
      return { x: axX, y: axY, width: axWidth, height: axHeight };
    }

    return {
      x: this.attentionFrame.x + (axX * this.attentionFrame.width),
      y: this.attentionFrame.y + (axY * this.attentionFrame.height),
      width: axWidth * this.attentionFrame.width,
      height: axHeight * this.attentionFrame.height
    };
  }

  /**
   * 🎯 ATTENTION FRAME: Convert viewport coordinates to AX-Tree relative coordinates.
   */
  viewportToScaleAX(vpX: number, vpY: number): { axX: number; axY: number } {
    if (!this.attentionFrame) {
      return { axX: vpX, axY: vpY };
    }

    return {
      axX: (vpX - this.attentionFrame.x) / this.attentionFrame.width,
      axY: (vpY - this.attentionFrame.y) / this.attentionFrame.height
    };
  }

  /**
   * 🎯 ATTENTION FRAME: Clamp coordinates to be within the attention frame.
   */
  clampToFrame(x: number, y: number): Point {
    if (!this.attentionFrame) {
      return { x, y };
    }

    const frame = this.attentionFrame;
    return {
      x: Math.max(frame.x, Math.min(x, frame.x + frame.width)),
      y: Math.max(frame.y, Math.min(y, frame.y + frame.height))
    };
  }

  /**
   * 📄 MULTI-PAGE: Open a new page and make it active.
   */
  async openPage(url: string): Promise<TaloxPageState> {
    const page = await this.browserManager.newPage();
    
    // Inject stealth scripts if in stealth mode
    if (this.mode === 'stealth') {
      await this.injectStealthScripts(page);
    }
    
    // Attach Security Guard
    await this.attachSecurityHooks(page);
    
    const stateCollector = new PageStateCollector(page);
    this.activePageIndex = this.pages.length;
    this.pages.push(stateCollector);
    this.pageMousePositions.set(this.activePageIndex, { x: 0, y: 0 });
    this.artifactBuilder.addAction('openPage', { url, pageIndex: this.activePageIndex });
    
    await page.goto(url);
    
    const state = await stateCollector.collect(this.mode);
    state.bugs.push(...this.rulesEngine.analyze(state));
    this.lastState = state;
    return state;
  }

  /**
   * 📄 MULTI-PAGE: Close a page by index.
   */
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

  /**
   * 📄 MULTI-PAGE: Switch to a page by index.
   */
  switchPage(index: number): void {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`Invalid page index: ${index}`);
    }
    this.activePageIndex = index;
    this.artifactBuilder.addAction('switchPage', { index });
  }

  /**
   * 📄 MULTI-PAGE: Get the total number of open pages.
   */
  getPageCount(): number {
    return this.pages.length;
  }

  /**
   * 📄 MULTI-PAGE: Get the active page index.
   */
  getActivePageIndex(): number {
    return this.activePageIndex;
  }

  /**
   * 📄 MULTI-PAGE: Get the active page state collector.
   */
  getActivePage(): PageStateCollector | null {
    if (this.activePageIndex < 0 || this.activePageIndex >= this.pages.length) {
      return null;
    }
    return this.pages[this.activePageIndex] ?? null;
  }

  /**
   * 📄 MULTI-PAGE: Get all open pages.
   */
  getAllPages(): PageStateCollector[] {
    return [...this.pages];
  }

  /**
   * 🛡️ SECURITY: Attach behavior monitoring and request guards to a page.
   */
  private async attachSecurityHooks(page: any): Promise<void> {
    if (!this.profile || this.profile.class === 'sandbox') return;

    // 1. Outbound Request Guard
    await page.route('**/*', (route: any) => {
      const request = route.request();
      const method = request.method();
      const url = request.url();

      // Basic heuristic: Prevent outbound POST/PUT to unknown domains if ops/qa
      if ((method === 'POST' || method === 'PUT') && this.profile?.class === 'ops') {
        const postData = request.postData() || '';
        // Very basic credential scanner regex (e.g., typical token formats)
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
        // Just dismiss to prevent hanging the agent
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
          // Extremely simple heuristic for potentially malicious behaviors
          if (url.includes('exfil') || url.includes('tracker') || url.includes('fingerprint')) {
            console.warn(`🛡️ SECURITY GUARD: Suspicious script loaded: ${url}`);
          }
        }
      });
    }
  }

  /**
   * 🎭 STEALTH: Inject evasion scripts to bypass bot detection.
   */
  private async injectStealthScripts(page: any): Promise<void> {
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
              // Add subtle noise to the last pixel
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

  async launch(profileId: string, profileClass: ProfileClass, mode: TaloxMode = 'browse', browserType: BrowserType = 'chromium') {
    this.mode = mode;
    this.profile = await this.profileVault.createProfile(profileId, profileClass, 'Agent Session');
    this.generateBehavioralDNA(profileId);

    let launchOptions: any = {};

    // STEALTH: Randomize parameters once per session
    if (this.mode === 'stealth') {
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
      const webgl = this.webglRenderers[Math.floor(Math.random() * this.webglRenderers.length)];
      
      this.selectedUserAgent = ua ?? this.userAgents[0] ?? null;
      this.webglInfo = webgl ?? this.webglRenderers[0] ?? null;
      
      // Randomize viewport: 1280-1920 wide, 720-1080 tall
      const width = 1280 + Math.floor(Math.random() * (1920 - 1280));
      const height = 720 + Math.floor(Math.random() * (1080 - 720));
      
      if (this.selectedUserAgent) {
        launchOptions.userAgent = this.selectedUserAgent;
        console.log(`Stealth Launch: UA=${this.selectedUserAgent.slice(0, 30)}..., Viewport=${width}x${height}`);
      }
      
      launchOptions.viewport = { width, height };
    }

    const context = await this.browserManager.launch(this.profile, this.mode, browserType, launchOptions);
    const page = await context.newPage();
    
    // Inject stealth scripts if in stealth mode
    if (this.mode === 'stealth') {
      await this.injectStealthScripts(page);
    }

    // Attach Security Guard
    await this.attachSecurityHooks(page);

    const stateCollector = new PageStateCollector(page);
    this.activePageIndex = 0;
    this.pages = [stateCollector];
    this.pageMousePositions.set(0, { x: 0, y: 0 });
    this.artifactBuilder.addAction('launch', { profileId, profileClass, mode, browserType, launchOptions });
  }

  private densityCache: Map<string, number> = new Map();
  private isFirstNavigation: boolean = true;
  private selectedUserAgent: string | null = null;
  private webglInfo: { vendor: string; renderer: string } | null = null;

  private userAgents: string[] = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  ];

  private webglRenderers: { vendor: string; renderer: string }[] = [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Apple Inc.', renderer: 'Apple M1' },
    { vendor: 'Apple Inc.', renderer: 'Apple M2' }
  ];

  async navigate(url: string): Promise<TaloxPageState> {
    const page = this.getPage();

    await this.checkRiskyAction('navigate', url);

    // Policy Check
    if (this.profile && !this.policyEngine.isAllowed(this.profile.class, url)) {
        throw new Error(`Policy Violation: URL ${url} not allowed for ${this.profile.class} profile`);
    }

    // Session Warmup: In stealth mode, navigate to a neutral page first
    if (this.mode === 'stealth' && this.isFirstNavigation && url !== 'about:blank' && !url.includes('google.com')) {
        console.log('Stealth Warmup: Navigating to about:blank before target...');
        try {
            await page.goto('about:blank');
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        } catch (e) {
            // Ignore warmup failures
        }
        this.isFirstNavigation = false;
    }

    // Smart-Settle Wait: Ensure hydration before proceeding
    // In speed mode, use networkidle for better reliability with SPAs
    const waitOption = this.mode === 'speed' ? { waitUntil: 'networkidle' } as any : { waitUntil: 'load' } as any;

    await page.goto(url, waitOption);
    this.isFirstNavigation = false;
    this.densityCache.clear(); // Clear cache on navigation

    // Additional micro-settle for hydration gap
    const settleTime = this.mode === 'speed' ? 100 : 500;
    await new Promise(r => setTimeout(r, settleTime));

    this.artifactBuilder.addAction('navigate', { url, mode: this.mode });
    const state = await this.getActiveStateCollector().collect(this.mode);
    
    // Automatic Structural Analysis if we have a previous state
    if (this.lastState) {
        const structuralBugs = this.rulesEngine.diffStructural(this.lastState, state);
        state.bugs.push(...structuralBugs);
    }

    state.bugs.push(...this.rulesEngine.analyze(state));
    this.lastState = state;
    return state;
  }

  /**
   * 👁️ VISUAL VERIFICATION: Compare current page against a baseline.
   */
  async verifyVisual(baselineKey: string, autoSave: boolean = false): Promise<VisualDiffResult & { isMatch: boolean }> {
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

  async mouseMove(x: number, y: number): Promise<void> {
    const page = this.getPage();
    
    const clampedPos = this.attentionFrame ? this.clampToFrame(x, y) : { x, y };
    this.artifactBuilder.addAction('mouseMove', { x: clampedPos.x, y: clampedPos.y, hasAttentionFrame: !!this.attentionFrame });

    /**
     * MODE BEHAVIOR:
     * - SPEED: Direct Playwright mouse.move - no HumanMouse, no delays
     * - STEALTH: Full HumanMouse with Fitts's Law, curves, jitter
     * - DEBUG: HumanMouse for observation
     * - BROWSER/BALANCED: Full HumanMouse simulation
     * - HYBRID/QA: Direct Playwright with minimal processing
     */
    const isSpeedMode = this.mode === 'speed';
    const isFullHuman = this.mode === 'browse' || this.mode === 'stealth' || this.mode === 'balanced' || this.mode === 'debug';

    let effectiveMouseSpeed = this.settings.mouseSpeed;
    
    // Use adaptive stealth when enabled
    if (isFullHuman && this.settings.adaptiveStealthEnabled) {
      effectiveMouseSpeed = await this.getEffectiveMouseSpeed(clampedPos.x, clampedPos.y);
    }

    effectiveMouseSpeed = effectiveMouseSpeed * this.getDNAMouseSpeed();

    // SPEED MODE: Direct Playwright, no HumanMouse
    if (isSpeedMode) {
      await page.mouse.move(clampedPos.x, clampedPos.y);
    }
    // STEALTH/DEBUG/BROWSE/BALANCED: Full HumanMouse
    else if (isFullHuman) {
      await HumanMouse.move(page, clampedPos.x, clampedPos.y, 100, false, this.getCurrentLastMousePos(), effectiveMouseSpeed);
    }
    // HYBRID/QA: Direct Playwright
    else {
      await page.mouse.move(clampedPos.x, clampedPos.y);
    }
    this.setCurrentLastMousePos({ x: clampedPos.x, y: clampedPos.y });
    this.recordActivity();
  }

  async click(selector: string): Promise<TaloxPageState> {
    try {
      return await this._clickInternal(selector);
    } catch (error: any) {
      console.warn(`Click failed for ${selector}, attempting self-healing recovery...`);
      const recoveredNode = await this.recoverNodeBySelector(selector);
      if (recoveredNode && recoveredNode.boundingBox) {
        const { x, y, width, height } = recoveredNode.boundingBox;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        
        this.artifactBuilder.addAction('selfHealClick', { 
          originalSelector: selector, 
          recoveredNodeId: recoveredNode.id,
          coords: { x: centerX, y: centerY }
        });

        const page = this.getPage();
        await page.mouse.click(centerX, centerY);
        await new Promise(r => setTimeout(r, 500));
        return await this.getActiveStateCollector().collect(this.mode);
      }
      throw error;
    }
  }

  private async _clickInternal(selector: string): Promise<TaloxPageState> {
    const page = this.getPage();

    await this.checkRiskyAction('click', selector);

    // Policy Check
    if (this.profile && !this.policyEngine.canPerform(this.profile.class, 'click', selector)) {
        throw new Error(`Policy Violation: Action 'click' on '${selector}' blocked for ${this.profile.class} profile`);
    }

    this.artifactBuilder.addAction('click', { selector, hasAttentionFrame: !!this.attentionFrame });

    /**
     * MODE BEHAVIOR:
     * - SPEED: Direct Playwright calls only, no HumanMouse, no delays
     * - STEALTH: Full HumanMouse with Fitts's Law, curves, jitter, adaptive stealth
     * - DEBUG: HumanMouse for observation, full data collection
     * - BROWSER/BALANCED: Full HumanMouse simulation
     * - HYBRID/QA: Minimal delay with precision offset
     */
    const isSpeedMode = this.mode === 'speed';
    const isStealthMode = this.mode === 'stealth';
    const isDebugMode = this.mode === 'debug';
    const isFullHuman = this.mode === 'browse' || this.mode === 'stealth' || this.mode === 'balanced' || this.mode === 'debug';
    const isHybrid = this.mode === 'hybrid' || this.mode === 'qa';

    let effectiveMouseSpeed = this.settings.mouseSpeed;
    let targetBox: { x: number; y: number; width: number; height: number } | null = null;

    if (this.attentionFrame) {
      const frameElement = await this.findElementInFrame(selector);
      if (!frameElement) {
        throw new Error(`Element '${selector}' not found within attention frame`);
      }
      targetBox = frameElement.box;
    }

    // SPEED MODE: Completely bypass HumanMouse - direct Playwright, no delays
    if (isSpeedMode) {
      const element = targetBox ? null : await page.$(selector);
      const box = targetBox || (element ? await element.boundingBox() : null);
      if (box) {
        this.setCurrentLastMousePos({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      }
      // Direct Playwright click - absolute minimum overhead
      if (this.attentionFrame && targetBox) {
        await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
      } else {
        await page.click(selector, { timeout: 5000 });
      }
    }
    // STEALTH/DEBUG/BROWSE/BALANCED: Full HumanMouse with all human-like features
    else if (isFullHuman) {
      // Adaptive stealth applies to stealth mode and when enabled
      if ((isStealthMode || this.settings.adaptiveStealthEnabled) && !isDebugMode) {
        const element = targetBox ? null : await page.$(selector);
        const box = targetBox || (element ? await element.boundingBox() : null);
        if (box) {
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          effectiveMouseSpeed = await this.getEffectiveMouseSpeed(centerX, centerY);
        }
      }

      effectiveMouseSpeed = effectiveMouseSpeed * this.getDNAMouseSpeed();

      this.setCurrentLastMousePos(await HumanMouse.click(page, selector, false, this.getCurrentLastMousePos(), effectiveMouseSpeed));
    }
    // HYBRID/QA: Minimal human-like delay with precision offset
    else if (isHybrid) {
      await new Promise(r => setTimeout(r, (100 + Math.random() * 200) / effectiveMouseSpeed));
      
      const precisionOffset = this.getPrecisionOffset();
      
      if (this.attentionFrame && targetBox) {
        const targetX = targetBox.x + targetBox.width / 2 + precisionOffset.x;
        const targetY = targetBox.y + targetBox.height / 2 + precisionOffset.y;
        await page.mouse.click(targetX, targetY);
      } else {
        const element = await page.$(selector);
        if (element) {
          const box = await element.boundingBox();
          if (box) {
            const targetX = box.x + box.width / 2 + precisionOffset.x;
            const targetY = box.y + box.height / 2 + precisionOffset.y;
            await page.mouse.click(targetX, targetY);
          } else {
            await page.click(selector, { timeout: 5000 });
          }
        } else {
          await page.click(selector, { timeout: 5000 });
        }
      }
    }

    // Give some time for potential navigation to start
    await new Promise(r => setTimeout(r, 500));

    this.recordActivity();

    try {
        return await this.getActiveStateCollector().collect(this.mode);
    } catch (e) {
        // If context is destroyed, navigation likely occurred
        return {
            url: page.url(),
            title: 'Navigating...',
            timestamp: new Date().toISOString(),
            mode: this.mode,
            console: { errors: [] },
            network: { failedRequests: [] },
            nodes: [],
            interactiveElements: [],
            bugs: []
        };
    }
  }

  async type(selector: string, text: string): Promise<TaloxPageState> {
    try {
      return await this._typeInternal(selector, text);
    } catch (error: any) {
      console.warn(`Type failed for ${selector}, attempting self-healing recovery...`);
      const recoveredNode = await this.recoverNodeBySelector(selector);
      if (recoveredNode && recoveredNode.boundingBox) {
        const { x, y, width, height } = recoveredNode.boundingBox;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        
        this.artifactBuilder.addAction('selfHealType', { 
          originalSelector: selector, 
          recoveredNodeId: recoveredNode.id,
          coords: { x: centerX, y: centerY }
        });

        const page = this.getPage();
        await page.mouse.click(centerX, centerY);
        await page.keyboard.type(text);
        return await this.getActiveStateCollector().collect(this.mode);
      }
      throw error;
    }
  }

  private async _typeInternal(selector: string, text: string): Promise<TaloxPageState> {
    const page = this.getPage();

    await this.checkRiskyAction('type', `${selector} (text: ${text})`);

    // Policy Check
    if (this.profile && !this.policyEngine.canPerform(this.profile.class, 'type', selector)) {
        throw new Error(`Policy Violation: Action 'type' on '${selector}' blocked for ${this.profile.class} profile`);
    }

    this.artifactBuilder.addAction('type', { selector, text, hasAttentionFrame: !!this.attentionFrame });
    
    /**
     * MODE BEHAVIOR:
     * - SPEED: Direct Playwright type - no HumanMouse, no delays, no typo simulation
     * - STEALTH: Full HumanMouse with typo simulation, randomized delays, DNA-influenced rhythm
     * - DEBUG: HumanMouse with typo simulation for observation
     * - BROWSER/BALANCED: Full HumanMouse with typo simulation
     * - HYBRID/QA: Fast but with minimal delay
     */
    const isSpeedMode = this.mode === 'speed';
    const isStealthMode = this.mode === 'stealth';
    const isFullHuman = this.mode === 'browse' || this.mode === 'stealth' || this.mode === 'balanced' || this.mode === 'debug';
    const isHybrid = this.mode === 'hybrid' || this.mode === 'qa';

    let targetBox: { x: number; y: number; width: number; height: number } | null = null;
    if (this.attentionFrame) {
      const frameElement = await this.findElementInFrame(selector);
      if (!frameElement) {
        throw new Error(`Element '${selector}' not found within attention frame`);
      }
      targetBox = frameElement.box;
    }

    // SPEED MODE: Direct Playwright type - no delays, no HumanMouse
    if (isSpeedMode) {
      if (this.attentionFrame && targetBox) {
        await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
        await page.keyboard.type(text);
      } else {
        await page.type(selector, text, { timeout: 5000 });
      }
    }
    // STEALTH/DEBUG/BROWSE/BALANCED: Full HumanMouse with all features
    else if (isFullHuman) {
        const dnaSpeed = this.getDNAMouseSpeed();
        
        // Move to element first using HumanMouse
        if (this.attentionFrame && targetBox) {
          const centerX = targetBox.x + targetBox.width * (0.2 + Math.random() * 0.6);
          const centerY = targetBox.y + targetBox.height * (0.2 + Math.random() * 0.6);
          await HumanMouse.move(page, centerX, centerY, targetBox.width, false, this.getCurrentLastMousePos(), this.settings.mouseSpeed * dnaSpeed);
          await page.mouse.click(centerX, centerY);
          this.setCurrentLastMousePos({ x: Math.round(centerX), y: Math.round(centerY) });
        } else {
          this.setCurrentLastMousePos(await HumanMouse.click(page, selector, true, this.getCurrentLastMousePos(), this.settings.mouseSpeed * dnaSpeed));
        }
        
        // STEALTH MODE: Always use typo simulation
        // DEBUG/BROWSE/BALANCED: Use typo simulation based on settings
        const useTypoSimulation = isStealthMode || this.settings.typoProbability > 0;
        const dnaTypingDelay = this.getDNATypingDelay();
        
        if (useTypoSimulation) {
            await this.typeWithTypos(page, selector, text);
        } else {
            await page.type(selector, text, { 
                delay: (dnaTypingDelay.min + Math.random() * (dnaTypingDelay.max - dnaTypingDelay.min)) / this.settings.mouseSpeed 
            });
        }
    }
    // HYBRID/QA: Fast but with minimal delay
    else if (isHybrid) {
        if (this.attentionFrame && targetBox) {
          await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
        } else {
          await page.click(selector, { timeout: 5000 });
        }
        await page.type(selector, text, { delay: 20 / this.settings.mouseSpeed });
    }

    this.recordActivity();
    return this.getActiveStateCollector().collect(this.mode);
  }

  /**
   * 🩹 SELF-HEALING: Attempt to find a replacement node if the original selector failed.
   */
  private async recoverNodeBySelector(selector: string): Promise<TaloxNode | null> {
    const state = await this.getActiveStateCollector().collect(this.mode);
    const nodes = state.nodes;

    // 1. Try to extract keywords from selector (e.g., text, role, class, id)
    const cleanSelector = selector.replace(/[#.[\]()=]/g, ' ').trim();
    const keywords = cleanSelector.split(/\s+/).filter(k => k.length > 2);

    if (keywords.length === 0) return null;

    // 2. Score nodes based on keyword matches
    let bestNode: TaloxNode | null = null;
    let bestScore = 0;

    for (const node of nodes) {
      let score = 0;
      const nodeText = (node.name || '').toLowerCase();
      const nodeRole = (node.role || '').toLowerCase();
      
      for (const kw of keywords) {
        const lowerKw = kw.toLowerCase();
        if (nodeText.includes(lowerKw)) score += 10;
        if (nodeRole.includes(lowerKw)) score += 5;
        if (node.id.toLowerCase().includes(lowerKw)) score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    // Only return if we have a reasonably confident match
    return bestScore >= 10 ? bestNode : null;
  }

  /**
   * Types text with human-like typo simulation.
   * When a typo occurs: types wrong char → pauses → backspaces → types correct char
   */
  private async typeWithTypos(page: any, selector: string, text: string): Promise<void> {
    const dnaTypingDelay = this.getDNATypingDelay();
    const baseDelay = (dnaTypingDelay.min + Math.random() * (dnaTypingDelay.max - dnaTypingDelay.min)) / this.settings.mouseSpeed;
    
    let charIndex = 0;
    for (const char of text) {
        const shouldTypo = Math.random() < this.settings.typoProbability;
        const shouldPause = Math.random() < 0.05; // 5% chance of a thinking pause
        const shouldDoubleTap = Math.random() < 0.02; // 2% chance of double-tap error

        if (shouldPause && charIndex > 0) {
            // Thinking Pause: 300-800ms
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
        }
        
        if (shouldTypo) {
            const typoChar = this.getTypoChar(char);
            await page.keyboard.type(typoChar, { delay: baseDelay * 0.5 });
            
            await new Promise(r => setTimeout(r, baseDelay * 2 + Math.random() * 200));
            
            await page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, baseDelay));
        }

        if (shouldDoubleTap) {
            await page.keyboard.type(char + char, { delay: baseDelay * 0.4 });
            await new Promise(r => setTimeout(r, baseDelay * 3));
            await page.keyboard.press('Backspace');
        } else {
            await page.keyboard.type(char, { delay: baseDelay });
        }
        
        charIndex++;
    }
  }

  /**
   * Gets a nearby character on QWERTY keyboard for realistic typo simulation
   */
  private getTypoChar(char: string): string {
    const lowerChar = char.toLowerCase();
    
    // Case-Sensitivity Error: 20% of typos are just wrong case
    if (Math.random() < 0.2) {
      return char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
    }

    const neighbors = this.keyboardNeighbors.get(lowerChar);
    
    if (neighbors && neighbors.length > 0) {
        const typoChar = neighbors[Math.floor(Math.random() * neighbors.length)] || 'a';
        // Match case of original char
        return char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar.toLowerCase();
    }
    
    return this.getRandomChar();
  }

  /**
   * Returns a random character when no keyboard neighbors are available
   */
  private getRandomChar(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return chars[Math.floor(Math.random() * chars.length)] || 'a';
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Enable or disable adaptive stealth functionality
   */
  setAdaptiveStealthEnabled(enabled: boolean): void {
    this.settings.adaptiveStealthEnabled = enabled;
    this.artifactBuilder.addAction('setAdaptiveStealthEnabled', { enabled });
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Configure adaptive stealth sensitivity (0.1 = low, 2.0 = high)
   */
  setAdaptiveStealthSensitivity(sensitivity: number): void {
    this.settings.adaptiveStealthSensitivity = Math.max(0.1, Math.min(2.0, sensitivity));
    this.artifactBuilder.addAction('setAdaptiveStealthSensitivity', { sensitivity: this.settings.adaptiveStealthSensitivity });
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Configure the radius for element density calculation
   */
  setAdaptiveStealthRadius(radius: number): void {
    this.settings.adaptiveStealthRadius = Math.max(50, Math.min(500, radius));
    this.artifactBuilder.addAction('setAdaptiveStealthRadius', { radius: this.settings.adaptiveStealthRadius });
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Calculate the density of interactive elements around a target point
   * Returns a value between 0 (sparse) and 1 (dense)
   */
  async calculateElementDensity(x: number, y: number): Promise<number> {
    if (!this.settings.adaptiveStealthEnabled) {
      return 0.5;
    }

    // Density Map Caching: Round coordinates to nearest 100px to improve cache hits
    const cacheKey = `${Math.round(x / 100) * 100},${Math.round(y / 100) * 100}`;
    if (this.densityCache.has(cacheKey)) {
      return this.densityCache.get(cacheKey)!;
    }

    const page = this.getPage();
    const radius = this.settings.adaptiveStealthRadius;
    const sensitivity = this.settings.adaptiveStealthSensitivity;

    try {
      const density = await page.evaluate(async (targetX: number, targetY: number, searchRadius: number) => {
        const allElements = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [tabindex]'));
        
        let nearbyCount = 0;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        for (const el of allElements) {
          const rect = el.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          if (centerX >= 0 && centerX <= viewportWidth && centerY >= 0 && centerY <= viewportHeight) {
            const distance = Math.sqrt(Math.pow(centerX - targetX, 2) + Math.pow(centerY - targetY, 2));
            if (distance <= searchRadius) {
              nearbyCount++;
            }
          }
        }

        const maxExpectedElements = 50;
        const normalizedDensity = Math.min(nearbyCount / maxExpectedElements, 1.0);
        return normalizedDensity;
      }, x, y, radius);

      const finalDensity = density * sensitivity;
      this.densityCache.set(cacheKey, finalDensity);
      return finalDensity;
    } catch (error) {
      return 0.5;
    }
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Get adaptive mouse speed based on element density
   * Dense areas = slower (more stealth), sparse areas = faster
   */
  getAdaptiveMouseSpeed(density: number): number {
    if (!this.settings.adaptiveStealthEnabled) {
      return this.settings.mouseSpeed;
    }

    const baseSpeed = this.settings.mouseSpeed;
    const minSpeedFactor = 0.3;
    const speedFactor = 1 - (density * (1 - minSpeedFactor));
    
    return Math.max(0.1, baseSpeed * speedFactor);
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Get adaptive jitter based on element density
   * Dense areas = more jitter (human-like imprecision), sparse areas = less jitter
   */
  getAdaptiveJitter(density: number): number {
    if (!this.settings.adaptiveStealthEnabled) {
      return 0;
    }

    const baseJitter = 5;
    const maxJitter = 25;
    return baseJitter + (density * (maxJitter - baseJitter));
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Get the effective mouse speed considering density at target point
   */
  async getEffectiveMouseSpeed(targetX: number, targetY: number): Promise<number> {
    if (!this.settings.adaptiveStealthEnabled) {
      return this.settings.mouseSpeed;
    }

    const density = await this.calculateElementDensity(targetX, targetY);
    return this.getAdaptiveMouseSpeed(density);
  }

  /**
   * 🎯 VIEWPORT ADAPTIVE STEALTH
   * Get the effective jitter considering density at target point
   */
  async getEffectiveJitter(targetX: number, targetY: number): Promise<number> {
    if (!this.settings.adaptiveStealthEnabled) {
      return 0;
    }

    const density = await this.calculateElementDensity(targetX, targetY);
    return this.getAdaptiveJitter(density);
  }

  /**
   * 🎯 ADAPTIVE PRECISION DECAY
   * Get random x,y offset based on precisionDecay setting
   * Returns offset that simulates human imperfection
   * @returns Point with x,y offset (typically 1-5 pixels based on decay level)
   */
  getPrecisionOffset(): Point {
    const decay = this.settings.precisionDecay;
    
    if (decay <= 0) {
      return { x: 0, y: 0 };
    }

    const maxOffset = 5 * decay;
    const minOffset = 1 * decay;
    
    const angle = Math.random() * 2 * Math.PI;
    const distance = minOffset + Math.random() * (maxOffset - minOffset);
    
    return {
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance)
    };
  }

  /**
   * 🎯 ADAPTIVE PRECISION DECAY
   * Set the precision decay level
   * @param decay - 0.0 = perfect precision, 1.0 = maximum decay
   */
  setPrecisionDecay(decay: number): void {
    this.settings.precisionDecay = Math.max(0, Math.min(1, decay));
    this.artifactBuilder.addAction('setPrecisionDecay', { precisionDecay: this.settings.precisionDecay });
  }

  /**
   * 🎯 ADAPTIVE PRECISION DECAY
   * Get current precision decay level
   */
  getPrecisionDecay(): number {
    return this.settings.precisionDecay;
  }

  async stop() {
    await this.stopAutoThinking();
    await this.browserManager.close();
  }

  /**
   * 🤖 AUTOMATED THINKING: Check if current mode supports auto-thinking
   */
  private isAutoThinkingModeSupported(): boolean {
    return this.mode === 'stealth' || this.mode === 'balanced' || this.mode === 'browse';
  }

  /**
   * 🤖 AUTOMATED THINKING: Start idle behavior monitoring
   * Monitors for idle periods and triggers thinking behaviors automatically
   */
  startAutoThinking(): void {
    if (!this.settings.automaticThinkingEnabled) {
      this.artifactBuilder.addAction('startAutoThinking', { reason: 'disabled' });
      return;
    }

    if (!this.isAutoThinkingModeSupported()) {
      this.artifactBuilder.addAction('startAutoThinking', { reason: 'unsupported_mode', mode: this.mode });
      return;
    }

    if (this.isAutoThinkingActive) {
      return;
    }

    this.isAutoThinkingActive = true;
    this.lastActivityTimestamp = Date.now();

    this.autoThinkingCheckInterval = setInterval(() => {
      this.checkIdleAndThink();
    }, 1000);

    this.artifactBuilder.addAction('startAutoThinking', { 
      idleTimeout: this.settings.idleTimeout,
      mode: this.mode 
    });
  }

  /**
   * 🤖 AUTOMATED THINKING: Stop idle behavior monitoring
   */
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

  /**
   * 🤖 AUTOMATED THINKING: Manually trigger a thinking behavior
   * Executes micro-jitters, small cursor movements, and occasional micro-scrolls
   */
  async triggerThinkingBehavior(): Promise<void> {
    if (!this.isAutoThinkingModeSupported() || !this.settings.automaticThinkingEnabled) {
      return;
    }

    const behaviorType = Math.random();
    
    if (behaviorType < 0.4) {
      await this.performMicroJitter();
    } else if (behaviorType < 0.7) {
      await this.performSmallCursorMovement();
    } else {
      await this.performMicroScroll();
    }

    this.lastActivityTimestamp = Date.now();
    this.artifactBuilder.addAction('triggerThinkingBehavior', { behaviorType });
  }

  /**
   * 🤖 AUTOMATED THINKING: Check if idle and trigger thinking behavior
   */
  private async checkIdleAndThink(): Promise<void> {
    if (!this.isAutoThinkingActive || !this.settings.automaticThinkingEnabled) {
      return;
    }

    const idleTime = Date.now() - this.lastActivityTimestamp;
    
    if (idleTime >= this.settings.idleTimeout) {
      await this.triggerThinkingBehavior();
    }
  }

  /**
   * 🤖 AUTOMATED THINKING: Record user activity to reset idle timer
   */
  recordActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * 🤖 AUTOMATED THINKING: Perform micro-jitter - small random cursor movements
   */
  private async performMicroJitter(): Promise<void> {
    const page = this.getPage();
    const lastPos = this.getCurrentLastMousePos();
    
    const jitterAmount = 2 + Math.random() * 5;
    const angle = Math.random() * 2 * Math.PI;
    const offsetX = Math.round(Math.cos(angle) * jitterAmount);
    const offsetY = Math.round(Math.sin(angle) * jitterAmount);
    
    const newX = lastPos.x + offsetX;
    const newY = lastPos.y + offsetY;
    
    await page.mouse.move(newX, newY);
    this.setCurrentLastMousePos({ x: newX, y: newY });
  }

  /**
   * 🤖 AUTOMATED THINKING: Perform small cursor movement to nearby position
   */
  private async performSmallCursorMovement(): Promise<void> {
    const page = this.getPage();
    const lastPos = this.getCurrentLastMousePos();
    
    const movementRange = 20 + Math.random() * 40;
    const angle = Math.random() * 2 * Math.PI;
    const offsetX = Math.round(Math.cos(angle) * movementRange);
    const offsetY = Math.round(Math.sin(angle) * movementRange);
    
    const clampedPos = this.attentionFrame 
      ? this.clampToFrame(lastPos.x + offsetX, lastPos.y + offsetY)
      : { x: lastPos.x + offsetX, y: lastPos.y + offsetY };
    
    await page.mouse.move(clampedPos.x, clampedPos.y, { steps: 2 });
    this.setCurrentLastMousePos(clampedPos);
  }

  /**
   * 🤖 AUTOMATED THINKING: Perform micro-scroll
   */
  private async performMicroScroll(): Promise<void> {
    const page = this.getPage();
    
    const scrollAmount = 50 + Math.random() * 100;
    const scrollDirection = Math.random() > 0.5 ? -1 : 1;
    
    await page.mouse.wheel(0, scrollDirection * scrollAmount);
  }

  /**
   * 🤖 AUTOMATED THINKING: Get current auto-thinking status
   */
  isAutoThinkingRunning(): boolean {
    return this.isAutoThinkingActive;
  }

  /**
   * 🤖 AUTOMATED THINKING: Set automatic thinking enabled
   */
  setAutomaticThinkingEnabled(enabled: boolean): void {
    this.settings.automaticThinkingEnabled = enabled;
    this.artifactBuilder.addAction('setAutomaticThinkingEnabled', { enabled });
  }

  /**
   * 🤖 AUTOMATED THINKING: Set idle timeout
   */
  setIdleTimeout(timeoutMs: number): void {
    this.settings.idleTimeout = Math.max(1000, Math.min(60000, timeoutMs));
    this.artifactBuilder.addAction('setIdleTimeout', { idleTimeout: this.settings.idleTimeout });
  }

  // --- Helpers ---

  async waitForSelector(selector: string, timeout: number = 30000): Promise<void> {
    const page = this.getPage();
    await page.waitForSelector(selector, { timeout });
  }

  async waitForNavigation(timeout: number = 30000): Promise<void> {
    const page = this.getPage();
    await page.waitForNavigation({ timeout });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }

  /**
   * 🧬 BIOMECHANICAL FIDGET
   * Performs micro-scrolls and idle cursor movements during "agent thinking time"
   * to mimic human attention patterns.
   * Only runs when fidgetEnabled is true AND humanStealth > 0.3
   */
  async fidget(durationMs: number = 1500): Promise<void> {
    if (!this.settings.fidgetEnabled || this.settings.humanStealth <= 0.3) {
      return;
    }

    const page = this.getPage();
    const lastPos = this.getCurrentLastMousePos();
    await HumanMouse.fidget(page, lastPos.x, lastPos.y, durationMs);
  }

  /**
   * 🧠 THINK HELPER
   * A helper method that agents can call during thinking time.
   * Includes fidget behavior and returns a promise that resolves after the thinking duration.
   * Only performs fidget when fidgetEnabled is true AND humanStealth > 0.3
   */
  async think(durationMs: number = 2000): Promise<void> {
    const fidgetDuration = Math.min(durationMs, 2000);
    const remainingTime = durationMs - fidgetDuration;

    await this.fidget(fidgetDuration);

    if (remainingTime > 0) {
      await this.waitForTimeout(remainingTime);
    }
  }

  // --- Semantic Node Search Helpers ---

  /**
   * 🔍 SEMANTIC SEARCH: Find nodes matching text content.
   * @param text - Text to search for
   * @param fuzzy - If true, performs case-insensitive partial match (default: false - exact match)
   */
  findNodeByText(text: string, fuzzy: boolean = false): TaloxNode | null {
    const state = this.getActiveStateCollector();
    const allNodes = (state as any).state?.nodes || [];
    
    const normalizedSearch = fuzzy ? text.toLowerCase() : text;
    
    for (const node of allNodes) {
      const nodeText = node.name || '';
      const normalizedText = fuzzy ? nodeText.toLowerCase() : nodeText;
      
      if (fuzzy ? normalizedText.includes(normalizedSearch) : normalizedText === normalizedSearch) {
        return node;
      }
    }
    
    return null;
  }

  /**
   * 🔍 SEMANTIC SEARCH: Find all nodes matching text content.
   * @param text - Text to search for
   * @param fuzzy - If true, performs case-insensitive partial match (default: false - exact match)
   */
  findNodesByText(text: string, fuzzy: boolean = false): TaloxNode[] {
    const state = this.getActiveStateCollector();
    const allNodes = (state as any).state?.nodes || [];
    
    const normalizedSearch = fuzzy ? text.toLowerCase() : text;
    const results: TaloxNode[] = [];
    
    for (const node of allNodes) {
      const nodeText = node.name || '';
      const normalizedText = fuzzy ? nodeText.toLowerCase() : nodeText;
      
      if (fuzzy ? normalizedText.includes(normalizedSearch) : normalizedText === normalizedSearch) {
        results.push(node);
      }
    }
    
    return results;
  }

  /**
   * 🔍 SEMANTIC SEARCH: Find a node by AX-Tree role.
   * @param role - Role to search for (e.g., 'button', 'link', 'textbox')
   */
  findNodeByRole(role: string): TaloxNode | null {
    const state = this.getActiveStateCollector();
    const allNodes = (state as any).state?.nodes || [];
    const normalizedRole = role.toLowerCase();
    
    for (const node of allNodes) {
      const nodeRole = (node.role || '').toLowerCase();
      if (nodeRole === normalizedRole) {
        return node;
      }
    }
    
    return null;
  }

  /**
   * 🔍 SEMANTIC SEARCH: Find all nodes matching any of the given roles.
   * @param roles - Array of roles to search for (e.g., ['button', 'link', 'textbox'])
   */
  findNodesByRole(roles: string[]): TaloxNode[] {
    const state = this.getActiveStateCollector();
    const allNodes = (state as any).state?.nodes || [];
    const normalizedRoles = roles.map(r => r.toLowerCase());
    const results: TaloxNode[] = [];
    
    for (const node of allNodes) {
      const nodeRole = (node.role || '').toLowerCase();
      if (normalizedRoles.includes(nodeRole)) {
        results.push(node);
      }
    }
    
    return results;
  }

  /**
   * 🔍 SEMANTIC SEARCH: Get all interactive elements from current page state.
   * Interactive elements include: button, link, textbox, checkbox, radio, combobox, menu, menuitem, tab, slider, switch, searchbox
   */
  findInteractiveNodes(): TaloxNode[] {
    const interactiveRoles = [
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 
      'menu', 'menuitem', 'tab', 'slider', 'switch', 'searchbox',
      'input', 'text area', 'anchor'
    ];
    
    return this.findNodesByRole(interactiveRoles);
  }

  /**
   * 🧠 LLM COMPRESSION: Prune non-interactive/decorative nodes from AX-Tree to save context window.
   */
  compressStateForLLM(state: TaloxPageState): any {
    const interactiveRoles = new Set([
      'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 
      'menu', 'menuitem', 'tab', 'slider', 'switch', 'searchbox', 'input', 'listbox', 'option'
    ]);

    const prunedNodes = state.nodes.filter(node => {
      // Keep nodes with explicit interactive roles
      if (interactiveRoles.has((node.role || '').toLowerCase())) return true;
      // Keep text nodes if they are not empty
      if (node.role === 'StaticText' || node.role === 'text') {
        return (node.name || '').trim().length > 0;
      }
      // Keep headings for structure
      if ((node.role || '').toLowerCase() === 'heading') return true;
      
      return false;
    });

    return {
      url: state.url,
      title: state.title,
      nodes: prunedNodes.map(n => ({
        role: n.role,
        name: n.name,
        value: n.attributes?.value,
        id: n.id // keep ID for clicking
      }))
    };
  }

  private riskyActionHook?: (action: string, target: string) => Promise<boolean>;

  /**
   * 🛡️ HUMAN-IN-THE-LOOP: Set a callback to approve/deny risky actions before execution.
   */
  setOnRiskyActionHook(hook: (action: string, target: string) => Promise<boolean>) {
    this.riskyActionHook = hook;
  }

  /**
   * Internal check for risky actions.
   */
  private async checkRiskyAction(action: string, target: string): Promise<void> {
    if (this.profile && this.profile.class === 'ops' && this.riskyActionHook) {
      const isApproved = await this.riskyActionHook(action, target);
      if (!isApproved) {
        throw new Error(`Human-in-the-Loop blocked risky action: ${action} on ${target}`);
      }
    }
  }
}
