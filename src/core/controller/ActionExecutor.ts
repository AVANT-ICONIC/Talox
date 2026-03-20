/**
 * @file ActionExecutor.ts
 * @description Executes browser interactions on behalf of TaloxController.
 * Single responsibility: perform actions. All mode-routing, self-healing,
 * and human-simulation logic lives here.
 */

// ─── Re-exported types (consumers import from here via TaloxController) ────────
export type MovementStyle     = 'smooth' | 'jerky' | 'precise' | 'relaxed';
export type TypingRhythm      = 'fast' | 'medium' | 'slow' | 'variable';
export type AccelerationCurve = 'linear' | 'ease-out' | 'ease-in-out' | 'bezier';

import type { TaloxPageState, TaloxNode, Point } from '../../types/index.js';
import type { TaloxSettings } from '../../types/settings.js';
import type { TaloxEventMap } from '../../types/events.js';
import type { EventBus } from './EventBus.js';
import { HumanMouse, type CursorStepCallback } from '../HumanMouse.js';
import { SemanticMapper } from '../SemanticMapper.js';
import { PolicyEngine } from '../PolicyEngine.js';
import { ArtifactBuilder } from '../ArtifactBuilder.js';
import { PageStateCollector } from '../PageStateCollector.js';

export class ActionExecutor {
  private densityCache: Map<string, number> = new Map();

  private readonly keyboardNeighbors: Map<string, string[]> = new Map([
    ['q', ['w', 'a', 's']], ['w', ['q', 'e', 'a', 's', 'd']], ['e', ['w', 'r', 's', 'd', 'f']], ['r', ['e', 't', 'd', 'f', 'g']], ['t', ['r', 'y', 'f', 'g', 'h']], ['y', ['t', 'u', 'g', 'h', 'j']], ['u', ['y', 'i', 'h', 'j', 'k']], ['i', ['u', 'o', 'j', 'k', 'l']], ['o', ['i', 'p', 'k', 'l']], ['p', ['o', 'l']],
    ['a', ['q', 'w', 's', 'z', 'x']], ['s', ['w', 'e', 'd', 'x', 'z', 'a']], ['d', ['e', 'r', 'f', 'c', 'x', 's']], ['f', ['r', 't', 'g', 'v', 'c', 'd']], ['g', ['t', 'y', 'h', 'b', 'v', 'f']], ['h', ['y', 'u', 'j', 'n', 'b', 'g']], ['j', ['u', 'i', 'k', 'm', 'n', 'h']], ['k', ['i', 'o', 'l', 'm', 'j']], ['l', ['o', 'p', 'k']],
    ['z', ['a', 's', 'x']], ['x', ['s', 'd', 'c', 'z']], ['c', ['d', 'f', 'v', 'x']], ['v', ['f', 'g', 'b', 'c']], ['b', ['g', 'h', 'n', 'v']], ['n', ['h', 'j', 'm', 'b']], ['m', ['j', 'k', 'n']],
    ['1', ['2', 'q']], ['2', ['1', '3', 'q', 'w']], ['3', ['2', '4', 'w', 'e']], ['4', ['3', '5', 'e', 'r']], ['5', ['4', '6', 'r', 't']], ['6', ['5', '7', 't', 'y']], ['7', ['6', '8', 'y', 'u']], ['8', ['7', '9', 'u', 'i']], ['9', ['8', '0', 'i', 'o']], ['0', ['9', 'o', 'p']],
    [' ', ['v', 'b', 'n', 'm']]
  ]);

  constructor(
    private readonly settings: TaloxSettings,
    private readonly events: EventBus<TaloxEventMap>,
    private readonly artifactBuilder: ArtifactBuilder,
    private readonly policyEngine: PolicyEngine,
    private readonly semanticMapper: SemanticMapper,
    private getPage: () => any,
    private getActiveStateCollector: () => PageStateCollector,
    private getProfile: () => any,
    private getCurrentLastMousePos: () => Point,
    private setCurrentLastMousePos: (pos: Point) => void,
    private getAttentionFrame: () => any,
    private clampToFrame: (x: number, y: number) => Point,
    private findElementInFrame: (selector: string) => Promise<any>,
    private riskyActionHook: (() => Promise<boolean>) | undefined,
    private recordActivity: () => void,
    private getCursorStepCallback?: () => CursorStepCallback | undefined,
  ) {}

  // ─── Navigation ─────────────────────────────────────────────────────────────

  async navigate(url: string, isFirstNavigation: boolean, setFirstNavigation: (v: boolean) => void, lastState: TaloxPageState | null, rulesEngine: any): Promise<TaloxPageState> {
    const page = this.getPage();
    const profile = this.getProfile();
    const settings = this.settings;

    await this.checkRiskyAction('navigate', url);

    if (profile && !this.policyEngine.isAllowed(profile.class, url)) {
      throw new Error(`Policy Violation: URL ${url} not allowed for ${profile.class} profile`);
    }

    // Session Warmup: navigate to a neutral page first
    if (isFirstNavigation && url !== 'about:blank' && !url.includes('google.com')) {
      console.log('Session Warmup: Navigating to about:blank before target...');
      try {
        await page.goto('about:blank');
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
      } catch (_e) {
        // Ignore warmup failures
      }
      setFirstNavigation(false);
    }

    // Settle Wait: Ensure hydration before proceeding
    const waitOption = { waitUntil: 'networkidle' } as any;

    await page.goto(url, waitOption);
    setFirstNavigation(false);
    this.densityCache.clear();

    const settleTime = 500;
    await new Promise(r => setTimeout(r, settleTime));

    // Auto-think right after navigation to pass bot detection
    if (this.settings.automaticThinkingEnabled) {
      await this.fidget(2000);
    }

    this.artifactBuilder.addAction('navigate', { url });
    const state = await this.getActiveStateCollector().collect();

    if (lastState) {
      const structuralBugs = rulesEngine.diffStructural(lastState, state);
      state.bugs.push(...structuralBugs);
    }

    state.bugs.push(...rulesEngine.analyze(state));

    this.events.emit('navigation', { url: state.url, title: state.title });

    if (this.settings.verbosity > 0) {
      this.events.emit('stateChanged', state);
    }

    if (state.console.errors.length > 0 && this.settings.verbosity >= 2) {
      for (const error of state.console.errors) {
        this.events.emit('consoleError', { error, url: state.url });
      }
    }

    if (this.settings.verbosity >= 2) {
      for (const bug of state.bugs) {
        this.events.emit('bugDetected', bug);
      }
    }

    return state;
  }

  // ─── Click ──────────────────────────────────────────────────────────────────

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
        return await this.getActiveStateCollector().collect();
      }
      throw error;
    }
  }

  private async _clickInternal(selector: string): Promise<TaloxPageState> {
    const page = this.getPage();
    const profile = this.getProfile();
    const settings = this.settings;

    await this.checkRiskyAction('click', selector);

    if (profile && !this.policyEngine.canPerform(profile.class, 'click', selector)) {
      throw new Error(`Policy Violation: Action 'click' on '${selector}' blocked for ${profile.class} profile`);
    }

    const attentionFrame = this.getAttentionFrame();
    this.artifactBuilder.addAction('click', { selector, hasAttentionFrame: !!attentionFrame });

    const useRawMode = settings.humanStealth === 0;
    let effectiveMouseSpeed = settings.mouseSpeed;
    let targetBox: { x: number; y: number; width: number; height: number } | null = null;

    if (attentionFrame) {
      const frameElement = await this.findElementInFrame(selector);
      if (!frameElement) {
        throw new Error(`Element '${selector}' not found within attention frame`);
      }
      targetBox = frameElement.box;
    }

    if (useRawMode) {
      const element = targetBox ? null : await page.$(selector);
      const box = targetBox || (element ? await element.boundingBox() : null);
      if (box) {
        this.setCurrentLastMousePos({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      }
      if (attentionFrame && targetBox) {
        await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
      } else {
        await page.click(selector, { timeout: 5000 });
      }
    } else {
      if (settings.adaptiveStealthEnabled) {
        const element = targetBox ? null : await page.$(selector);
        const box = targetBox || (element ? await element.boundingBox() : null);
        if (box) {
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          effectiveMouseSpeed = await this.getEffectiveMouseSpeed(centerX, centerY);
        }
      }

      effectiveMouseSpeed = effectiveMouseSpeed * this.getDNAMouseSpeed(null);

      this.events.emit('agentActing');
      const onStep = this.getCursorStepCallback?.();
      const finalPos = await HumanMouse.click(page, selector, false, this.getCurrentLastMousePos(), effectiveMouseSpeed, onStep);
      this.setCurrentLastMousePos(finalPos);
      this.events.emit('cursorClicked', { x: finalPos.x, y: finalPos.y });
    }

    await new Promise(r => setTimeout(r, 500));
    this.recordActivity();

    try {
      return await this.getActiveStateCollector().collect();
    } catch (_e) {
      return {
        url: page.url(),
        title: 'Navigating...',
        timestamp: new Date().toISOString(),
        console: { errors: [] },
        network: { failedRequests: [] },
        nodes: [],
        interactiveElements: [],
        bugs: []
      };
    }
  }

  // ─── Type ────────────────────────────────────────────────────────────────────

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
        return await this.getActiveStateCollector().collect();
      }
      throw error;
    }
  }

  private async _typeInternal(selector: string, text: string): Promise<TaloxPageState> {
    const page = this.getPage();
    const profile = this.getProfile();
    const settings = this.settings;

    await this.checkRiskyAction('type', `${selector} (text: ${text})`);

    if (profile && !this.policyEngine.canPerform(profile.class, 'type', selector)) {
      throw new Error(`Policy Violation: Action 'type' on '${selector}' blocked for ${profile.class} profile`);
    }

    const attentionFrame = this.getAttentionFrame();
    this.artifactBuilder.addAction('type', { selector, text, hasAttentionFrame: !!attentionFrame });

    const useRawMode = settings.humanStealth === 0;

    let targetBox: { x: number; y: number; width: number; height: number } | null = null;
    if (attentionFrame) {
      const frameElement = await this.findElementInFrame(selector);
      if (!frameElement) {
        throw new Error(`Element '${selector}' not found within attention frame`);
      }
      targetBox = frameElement.box;
    }

    if (useRawMode) {
      if (attentionFrame && targetBox) {
        await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
        await page.keyboard.type(text);
      } else {
        await page.type(selector, text, { timeout: 5000 });
      }
    } else {
      const dnaSpeed = this.getDNAMouseSpeed(null);
      this.events.emit('agentActing');
      const onStep = this.getCursorStepCallback?.();

      if (attentionFrame && targetBox) {
        const centerX = targetBox.x + targetBox.width * (0.2 + Math.random() * 0.6);
        const centerY = targetBox.y + targetBox.height * (0.2 + Math.random() * 0.6);
        await HumanMouse.move(page, centerX, centerY, targetBox.width, false, this.getCurrentLastMousePos(), settings.mouseSpeed * dnaSpeed, onStep);
        await page.mouse.click(centerX, centerY);
        this.setCurrentLastMousePos({ x: Math.round(centerX), y: Math.round(centerY) });
        this.events.emit('cursorClicked', { x: Math.round(centerX), y: Math.round(centerY) });
      } else {
        const finalPos = await HumanMouse.click(page, selector, true, this.getCurrentLastMousePos(), settings.mouseSpeed * dnaSpeed, onStep);
        this.setCurrentLastMousePos(finalPos);
        this.events.emit('cursorClicked', { x: finalPos.x, y: finalPos.y });
      }

      const useTypoSimulation = settings.typoProbability > 0;
      const dnaTypingDelay = this.getDNATypingDelay(null);

      if (useTypoSimulation) {
        await this.typeWithTypos(page, selector, text);
      } else {
        await page.type(selector, text, {
          delay: (dnaTypingDelay.min + Math.random() * (dnaTypingDelay.max - dnaTypingDelay.min)) / settings.mouseSpeed
        });
      }
    }

    this.recordActivity();
    return this.getActiveStateCollector().collect();
  }

  // ─── Mouse Move ──────────────────────────────────────────────────────────────

  async mouseMove(x: number, y: number): Promise<void> {
    const page = this.getPage();
    const settings = this.settings;
    const attentionFrame = this.getAttentionFrame();

    const clampedPos = attentionFrame ? this.clampToFrame(x, y) : { x, y };
    this.artifactBuilder.addAction('mouseMove', { x: clampedPos.x, y: clampedPos.y, hasAttentionFrame: !!attentionFrame });

    this.events.emit('agentActing');

    const useRawMode = settings.humanStealth === 0;

    let effectiveMouseSpeed = settings.mouseSpeed;

    if (!useRawMode && settings.adaptiveStealthEnabled) {
      effectiveMouseSpeed = await this.getEffectiveMouseSpeed(clampedPos.x, clampedPos.y);
    }

    effectiveMouseSpeed = effectiveMouseSpeed * this.getDNAMouseSpeed(null);
    const onStep = this.getCursorStepCallback?.();

    if (useRawMode) {
      await page.mouse.move(clampedPos.x, clampedPos.y);
      this.events.emit('cursorMoved', { x: clampedPos.x, y: clampedPos.y });
    } else {
      await HumanMouse.move(page, clampedPos.x, clampedPos.y, 100, false, this.getCurrentLastMousePos(), effectiveMouseSpeed, onStep);
    }

    this.setCurrentLastMousePos({ x: clampedPos.x, y: clampedPos.y });
    this.recordActivity();
  }

  // ─── Scroll ──────────────────────────────────────────────────────────────────

  async scrollTo(selector: string, align: 'start' | 'center' | 'end' | 'nearest' = 'center'): Promise<void> {
    const page = this.getPage();
    if (!page) throw new Error('No active page');

    const element = await page.$(selector);
    if (!element) throw new Error(`Element not found: ${selector}`);

    await element.scrollIntoViewIfNeeded();
    await element.evaluate((el: any, block: string) => {
      el.scrollIntoView({ behavior: 'smooth', block });
    }, align);
  }

  // ─── Screenshot ──────────────────────────────────────────────────────────────

  async screenshot(options?: { selector?: string; path?: string }): Promise<Buffer | string> {
    const page = this.getPage();
    if (!page) throw new Error('No active page');

    if (options?.selector) {
      const element = await page.$(options.selector);
      if (!element) throw new Error(`Element not found: ${options.selector}`);
      return element.screenshot({ path: options.path, type: 'png' });
    }

    return page.screenshot({ path: options?.path, type: 'png', fullPage: true });
  }

  // ─── Extract Table ───────────────────────────────────────────────────────────

  async extractTable(selector: string): Promise<Array<Record<string, string>>> {
    const page = this.getPage();
    if (!page) throw new Error('No active page');

    const table = await page.$(selector);
    if (!table) throw new Error(`Table not found: ${selector}`);

    return table.evaluate((tableEl: HTMLTableElement) => {
      const headers = Array.from(tableEl.querySelectorAll('thead th, thead td'))
        .map(th => th.textContent?.trim() || `col${Math.random()}`);

      const rows = Array.from(tableEl.querySelectorAll('tbody tr, tr'));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        const rowData: Record<string, string> = {};
        cells.forEach((cell, i) => {
          const key = headers[i] || `col${i}`;
          rowData[key] = cell.textContent?.trim() || '';
        });
        return rowData;
      }).filter(row => Object.values(row).some(v => v));
    });
  }

  // ─── Find Element ────────────────────────────────────────────────────────────

  async findElement(text: string, elementType?: 'button' | 'link' | 'input' | 'checkbox' | 'radio' | 'menuitem' | 'any', lastState?: TaloxPageState | null): Promise<{ selector: string; boundingBox: any } | null> {
    if (!lastState) return null;

    const entities = this.semanticMapper.mapNodes(lastState.nodes, lastState.url);
    let filtered = entities;

    if (elementType && elementType !== 'any') {
      filtered = this.semanticMapper.filterByType(entities, [elementType as any]);
    }

    const matches = filtered.filter(e =>
      e.label.toLowerCase().includes(text.toLowerCase()) ||
      e.name.toLowerCase().includes(text.toLowerCase())
    );

    if (matches.length === 0) return null;

    const best = matches.sort((a, b) => b.confidence - a.confidence)[0];
    if (!best) return null;

    return {
      selector: best.id,
      boundingBox: best.boundingBox
    };
  }

  // ─── Evaluate ────────────────────────────────────────────────────────────────

  async evaluate<T = any>(script: string): Promise<T> {
    const page = this.getPage();
    if (!page) throw new Error('No active page');

    return page.evaluate(script);
  }

  // ─── Wait Helpers ────────────────────────────────────────────────────────────

  async waitForSelector(selector: string, timeout: number = 30000): Promise<void> {
    const page = this.getPage();
    await page.waitForSelector(selector, { timeout });
  }

  async waitForNavigation(timeout: number = 30000): Promise<void> {
    const page = this.getPage();
    await page.waitForNavigation({ timeout });
  }

  async waitForLoadState(state: string, timeout: number = 30000): Promise<void> {
    const page = this.getPage();
    if (!page) throw new Error('No active page');
    await page.waitForLoadState(state, { timeout });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }

  // ─── Fidget / Think ──────────────────────────────────────────────────────────

  async fidget(durationMs: number = 1500): Promise<void> {
    const settings = this.settings;
    if (!settings.fidgetEnabled || settings.humanStealth <= 0.3) {
      return;
    }

    this.events.emit('agentThinking');

    const page = this.getPage();
    const lastPos = this.getCurrentLastMousePos();

    let startX = lastPos.x;
    let startY = lastPos.y;
    if (startX === 0 && startY === 0) {
      const viewport = page.viewportSize();
      if (viewport) {
        startX = viewport.width * 0.5;
        startY = viewport.height * 0.5;
        if (!this.getCursorStepCallback?.()) {
          await page.mouse.move(startX, startY);
        }
        this.setCurrentLastMousePos({ x: startX, y: startY });
      }
    }

    const onStep = this.getCursorStepCallback?.();
    await HumanMouse.fidget(page, startX, startY, durationMs, onStep);
  }

  async think(durationMs: number = 2000): Promise<void> {
    this.events.emit('agentThinking');
    const fidgetDuration = Math.min(durationMs, 2000);
    const remainingTime = durationMs - fidgetDuration;

    await this.fidget(fidgetDuration);

    if (remainingTime > 0) {
      await this.waitForTimeout(remainingTime);
    }
  }

  // ─── Self-Healing ─────────────────────────────────────────────────────────────

  private async recoverNodeBySelector(selector: string): Promise<TaloxNode | null> {
    const state = await this.getActiveStateCollector().collect();
    const nodes = state.nodes;

    const cleanSelector = selector.replace(/[#.[\]()=]/g, ' ').trim();
    const keywords = cleanSelector.split(/\s+/).filter(k => k.length > 2);

    if (keywords.length === 0) return null;

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

    return bestScore >= 10 ? bestNode : null;
  }

  // ─── Typing Helpers ──────────────────────────────────────────────────────────

  private async typeWithTypos(page: any, selector: string, text: string): Promise<void> {
    const settings = this.settings;
    const dnaTypingDelay = this.getDNATypingDelay(null);
    const baseDelay = (dnaTypingDelay.min + Math.random() * (dnaTypingDelay.max - dnaTypingDelay.min)) / settings.mouseSpeed;

    let charIndex = 0;
    for (const char of text) {
      const shouldTypo = Math.random() < settings.typoProbability;
      const shouldPause = Math.random() < 0.05;
      const shouldDoubleTap = Math.random() < 0.02;

      if (shouldPause && charIndex > 0) {
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

  private getTypoChar(char: string): string {
    const lowerChar = char.toLowerCase();

    if (Math.random() < 0.2) {
      return char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
    }

    const neighbors = this.keyboardNeighbors.get(lowerChar);

    if (neighbors && neighbors.length > 0) {
      const typoChar = neighbors[Math.floor(Math.random() * neighbors.length)] || 'a';
      return char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar.toLowerCase();
    }

    return this.getRandomChar();
  }

  private getRandomChar(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return chars[Math.floor(Math.random() * chars.length)] || 'a';
  }

  // ─── Risky Action Check ──────────────────────────────────────────────────────

  private async checkRiskyAction(action: string, target: string): Promise<void> {
    const profile = this.getProfile();
    if (profile && profile.class === 'ops' && this.riskyActionHook) {
      const isApproved = await this.riskyActionHook();
      if (!isApproved) {
        throw new Error(`Human-in-the-Loop blocked risky action: ${action} on ${target}`);
      }
    }
  }

  // ─── Behavioral DNA Helpers ──────────────────────────────────────────────────

  getDNAMouseSpeed(behavioralDNA: any): number {
    if (!behavioralDNA) return 1.0;
    const settings = this.settings;
    const styleFactor = behavioralDNA.movementStyle === 'precise' ? 0.8 :
      behavioralDNA.movementStyle === 'relaxed' ? 1.2 : 1.0;
    return settings.mouseSpeed * styleFactor;
  }

  getDNAJitter(behavioralDNA: any): number {
    if (!behavioralDNA) return 0;
    return behavioralDNA.jitterFrequency * 20;
  }

  getDNATypingDelay(behavioralDNA: any): { min: number; max: number } {
    const settings = this.settings;
    if (!behavioralDNA) {
      return { min: settings.typingDelayMin, max: settings.typingDelayMax };
    }
    const rhythm = behavioralDNA.typingRhythm;
    const baseMin = settings.typingDelayMin;
    const baseMax = settings.typingDelayMax;

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

  // ─── Precision Offset / Decay ────────────────────────────────────────────────

  getPrecisionOffset(): Point {
    const settings = this.settings;
    const decay = settings.precisionDecay;

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

  setPrecisionDecay(decay: number): void {
    this.settings.precisionDecay = Math.max(0, Math.min(1, decay));
    this.artifactBuilder.addAction('setPrecisionDecay', { precisionDecay: this.settings.precisionDecay });
  }

  getPrecisionDecay(): number {
    return this.settings.precisionDecay;
  }

  // ─── Adaptive Stealth Controls ───────────────────────────────────────────────

  setAdaptiveStealthEnabled(enabled: boolean): void {
    this.settings.adaptiveStealthEnabled = enabled;
    this.artifactBuilder.addAction('setAdaptiveStealthEnabled', { enabled });
  }

  setAdaptiveStealthSensitivity(sensitivity: number): void {
    const clamped = Math.max(0.1, Math.min(2.0, sensitivity));
    this.settings.adaptiveStealthSensitivity = clamped;
    this.artifactBuilder.addAction('setAdaptiveStealthSensitivity', { sensitivity: clamped });
  }

  setAdaptiveStealthRadius(radius: number): void {
    const clamped = Math.max(50, Math.min(500, radius));
    this.settings.adaptiveStealthRadius = clamped;
    this.artifactBuilder.addAction('setAdaptiveStealthRadius', { radius: clamped });
  }

  // ─── Adaptive Stealth Calculations ──────────────────────────────────────────

  async calculateElementDensity(x: number, y: number): Promise<number> {
    const settings = this.settings;
    if (!settings.adaptiveStealthEnabled) {
      return 0.5;
    }

    const cacheKey = `${Math.round(x / 100) * 100},${Math.round(y / 100) * 100}`;
    if (this.densityCache.has(cacheKey)) {
      return this.densityCache.get(cacheKey)!;
    }

    const page = this.getPage();
    const radius = settings.adaptiveStealthRadius;
    const sensitivity = settings.adaptiveStealthSensitivity;

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
    } catch (_error) {
      return 0.5;
    }
  }

  getAdaptiveMouseSpeed(density: number): number {
    const settings = this.settings;
    if (!settings.adaptiveStealthEnabled) {
      return settings.mouseSpeed;
    }

    const baseSpeed = settings.mouseSpeed;
    const minSpeedFactor = 0.3;
    const speedFactor = 1 - (density * (1 - minSpeedFactor));

    return Math.max(0.1, baseSpeed * speedFactor);
  }

  getAdaptiveJitter(density: number): number {
    const settings = this.settings;
    if (!settings.adaptiveStealthEnabled) {
      return 0;
    }

    const baseJitter = 5;
    const maxJitter = 25;
    return baseJitter + (density * (maxJitter - baseJitter));
  }

  async getEffectiveMouseSpeed(targetX: number, targetY: number): Promise<number> {
    const settings = this.settings;
    if (!settings.adaptiveStealthEnabled) {
      return settings.mouseSpeed;
    }

    const density = await this.calculateElementDensity(targetX, targetY);
    return this.getAdaptiveMouseSpeed(density);
  }

  async getEffectiveJitter(targetX: number, targetY: number): Promise<number> {
    const settings = this.settings;
    if (!settings.adaptiveStealthEnabled) {
      return 0;
    }

    const density = await this.calculateElementDensity(targetX, targetY);
    return this.getAdaptiveJitter(density);
  }

  // ─── Density Cache ───────────────────────────────────────────────────────────

  clearDensityCache(): void {
    this.densityCache.clear();
  }
}
