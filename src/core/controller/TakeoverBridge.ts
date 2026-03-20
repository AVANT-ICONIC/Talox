/**
 * @file TakeoverBridge.ts
 * @description Agent overlay — glow frame, fake cursor, human takeover UI.
 *
 * Active whenever `settings.headed === true`. Injects a self-contained
 * JavaScript overlay via `page.addInitScript()` (persists across ALL navigations).
 *
 * Visual states:
 *   AGENT_RUNNING   — cyan glow border, fake arrow cursor with comet trail,
 *                     click blocker (blocks human mouse clicks on page),
 *                     "⏸ Take Over" button (bottom-center, auto-hides)
 *   WAITING_FOR_HUMAN — glow off, cursor hidden, blocker removed,
 *                        "▶ Resume Agent" button always visible
 *
 * Playwright API rules (do not deviate):
 *   Overlay injection   → page.addInitScript()   (persists across navigations)
 *   Browser → Node.js   → page.exposeFunction()  (persists across navigations)
 *   Node.js → Browser   → page.evaluate()        (one-shot updates, cursor pos etc)
 */

import type { Page } from 'playwright';
import type { EventBus } from './EventBus.js';
import type { TaloxEventMap } from '../../types/events.js';
import type { CursorStepCallback } from '../HumanMouse.js';

export type TakeoverState = 'AGENT_RUNNING' | 'WAITING_FOR_HUMAN';

// ─── Agent Overlay Bundle (injected into every page) ─────────────────────────

/**
 * Self-contained JavaScript string injected via page.addInitScript().
 * No build step required — pure DOM/CSS manipulation.
 * All elements carry aria-hidden="true" so the agent's AX-tree never sees them.
 */
const AGENT_OVERLAY_SCRIPT = /* js */ `
(function() {
  if (window.__taloxAgent__) return; // idempotent guard
  window.__taloxAgent__ = true;

  // ─── Constants ────────────────────────────────────────────────────────────
  var CYAN      = '#00D4FF';
  var CYAN_GLOW = 'rgba(0, 212, 255, 0.6)';
  var Z_GLOW    = 999997;
  var Z_BLOCKER = 999998;
  var Z_CURSOR  = 999999;
  var Z_BUTTON  = 1000000;

  // ─── State ────────────────────────────────────────────────────────────────
  var cursorX = -200, cursorY = -200;
  var trailPoints = [];
  var MAX_TRAIL   = 12;
  var isAgentRunning = true;
  var btnHideTimer = null;

  // ─── DOM Elements ─────────────────────────────────────────────────────────
  var style     = document.createElement('style');
  var glowEl    = document.createElement('div');
  var blockerEl = document.createElement('div');
  var cursorEl  = document.createElement('div');
  var spinnerEl = document.createElement('div');
  var btnWrap   = document.createElement('div');
  var btnEl     = document.createElement('button');
  var trailEls  = [];

  // ─── CSS ──────────────────────────────────────────────────────────────────
  style.textContent = [
    '@keyframes __talox_pulse { 0%,100%{opacity:.4} 50%{opacity:.75} }',
    '@keyframes __talox_orbit { from{transform:rotate(0deg) translateX(20px)} to{transform:rotate(360deg) translateX(20px)} }',
    '@keyframes __talox_ripple { 0%{width:0;height:0;opacity:.8} 100%{width:50px;height:50px;opacity:0} }',
    '@keyframes __talox_bounce { 0%,100%{transform:translateX(-50%) scale(1)} 40%{transform:translateX(-50%) scale(1.15)} 70%{transform:translateX(-50%) scale(0.95)} }',
    '@keyframes __talox_sweep { 0%{opacity:0} 100%{opacity:1} }',
  ].join('');

  function applyAttrs(el, attrs) {
    for (var k in attrs) el[k] = attrs[k];
  }

  function applyStyle(el, styles) {
    Object.assign(el.style, styles);
  }

  // Glow border
  applyAttrs(glowEl, { id: '__talox-glow', 'aria-hidden': 'true', role: 'presentation' });
  applyStyle(glowEl, {
    position: 'fixed', inset: '0', pointerEvents: 'none',
    zIndex: Z_GLOW, boxSizing: 'border-box',
    boxShadow: 'inset 0 0 0 3px ' + CYAN_GLOW,
    animation: '__talox_pulse 2s ease-in-out infinite',
    opacity: '0.4',
  });

  // Click blocker (transparent, blocks page clicks when agent runs)
  applyAttrs(blockerEl, { id: '__talox-blocker', 'aria-hidden': 'true', role: 'presentation' });
  applyStyle(blockerEl, {
    position: 'fixed', inset: '0', zIndex: Z_BLOCKER,
    background: 'transparent', cursor: 'default',
  });

  // Fake cursor arrow (CSS triangle)
  applyAttrs(cursorEl, { id: '__talox-cursor', 'aria-hidden': 'true', role: 'presentation' });
  applyStyle(cursorEl, {
    position: 'fixed', zIndex: Z_CURSOR,
    width: '0', height: '0', pointerEvents: 'none',
    borderLeft: '8px solid transparent',
    borderRight: '5px solid transparent',
    borderBottom: '16px solid ' + CYAN,
    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
    transform: 'rotate(-35deg)',
    left: cursorX + 'px', top: cursorY + 'px',
    transition: 'left 16ms linear, top 16ms linear',
    opacity: '0',
  });

  // Spinner ring orbiting cursor
  applyAttrs(spinnerEl, { id: '__talox-spinner', 'aria-hidden': 'true', role: 'presentation' });
  applyStyle(spinnerEl, {
    position: 'fixed', zIndex: Z_CURSOR,
    width: '40px', height: '40px',
    marginLeft: '-20px', marginTop: '-20px',
    borderRadius: '50%',
    border: '2px solid transparent',
    borderTopColor: CYAN,
    borderRightColor: CYAN,
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.3s ease',
    animation: 'none',
    left: cursorX + 'px', top: cursorY + 'px',
  });

  // Trail dots
  for (var i = 0; i < MAX_TRAIL; i++) {
    var t = document.createElement('div');
    applyAttrs(t, { 'aria-hidden': 'true', role: 'presentation' });
    applyStyle(t, {
      position: 'fixed', pointerEvents: 'none', zIndex: Z_CURSOR - 1,
      width: '5px', height: '5px', borderRadius: '50%',
      background: CYAN, opacity: '0',
      transition: 'opacity 0.1s linear',
      left: '-10px', top: '-10px',
    });
    trailEls.push(t);
  }

  // Takeover/Resume button wrapper
  applyAttrs(btnWrap, { id: '__talox-btn-wrap', 'aria-hidden': 'true', role: 'presentation' });
  applyStyle(btnWrap, {
    position: 'fixed', bottom: '20px', left: '50%',
    transform: 'translateX(-50%)',
    zIndex: Z_BUTTON, pointerEvents: 'auto',
    opacity: '0', transition: 'opacity 0.25s ease',
  });

  applyAttrs(btnEl, { id: '__talox-btn' });
  applyStyle(btnEl, {
    background: 'rgba(0,212,255,0.9)', color: '#000',
    border: 'none', borderRadius: '20px',
    padding: '8px 20px', fontSize: '13px', fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    cursor: 'pointer', letterSpacing: '0.3px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    transition: 'background 0.2s, transform 0.15s',
    userSelect: 'none',
  });
  btnEl.textContent = '⏸ Take Over';
  btnWrap.appendChild(btnEl);

  // ─── Mount to DOM ─────────────────────────────────────────────────────────
  function mount() {
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(glowEl);
    document.documentElement.appendChild(cursorEl);
    document.documentElement.appendChild(spinnerEl);
    for (var i = 0; i < trailEls.length; i++) document.documentElement.appendChild(trailEls[i]);
    document.documentElement.appendChild(btnWrap);
    setAgentRunning();
  }

  // ─── Trail ────────────────────────────────────────────────────────────────
  function addTrailPoint(x, y) {
    trailPoints.unshift({ x: x, y: y });
    if (trailPoints.length > MAX_TRAIL) trailPoints.pop();
    for (var i = 0; i < trailEls.length; i++) {
      var pt = trailPoints[i];
      if (pt) {
        var opacity = ((MAX_TRAIL - i) / MAX_TRAIL) * 0.55;
        applyStyle(trailEls[i], {
          left: pt.x + 'px', top: pt.y + 'px', opacity: String(opacity),
          width: (5 - i * 0.3) + 'px', height: (5 - i * 0.3) + 'px',
          marginLeft: '-2.5px', marginTop: '-2.5px',
        });
      } else {
        trailEls[i].style.opacity = '0';
      }
    }
  }

  // ─── State transitions ────────────────────────────────────────────────────
  function setAgentRunning() {
    isAgentRunning = true;
    // Glow on
    applyStyle(glowEl, {
      boxShadow: 'inset 0 0 0 3px ' + CYAN_GLOW,
      animation: '__talox_pulse 2s ease-in-out infinite',
      opacity: '0.4', display: 'block',
    });
    // Blocker on
    if (!blockerEl.parentElement) document.documentElement.appendChild(blockerEl);
    // Cursor visible
    cursorEl.style.opacity = '1';
    // Button state
    btnEl.textContent = '⏸ Take Over';
    applyStyle(btnEl, { background: 'rgba(0,212,255,0.9)', color: '#000' });
    applyStyle(btnWrap, { opacity: '0', transition: 'opacity 0.25s ease' });
    // Blocker events
    blockerEl.onmousemove = function() { showBtn(); };
    blockerEl.onclick = function() { flashBtn(); };
  }

  function setAgentPaused() {
    isAgentRunning = false;
    // Glow off
    applyStyle(glowEl, { animation: 'none', opacity: '0' });
    // Blocker off
    if (blockerEl.parentElement) blockerEl.parentElement.removeChild(blockerEl);
    // Cursor off
    cursorEl.style.opacity = '0';
    spinnerEl.style.opacity = '0';
    // Clear trail
    for (var i = 0; i < trailEls.length; i++) trailEls[i].style.opacity = '0';
    trailPoints = [];
    // Button state
    btnEl.textContent = '▶ Resume Agent';
    applyStyle(btnEl, { background: 'rgba(255,170,0,0.95)', color: '#000' });
    applyStyle(btnWrap, { opacity: '1', transition: 'opacity 0.3s ease' });
    // Clear hide timer
    if (btnHideTimer) { clearTimeout(btnHideTimer); btnHideTimer = null; }
  }

  // ─── Button visibility ────────────────────────────────────────────────────
  function showBtn() {
    if (!isAgentRunning) return; // always visible when paused
    btnWrap.style.opacity = '1';
    if (btnHideTimer) clearTimeout(btnHideTimer);
    btnHideTimer = setTimeout(function() { btnWrap.style.opacity = '0'; }, 5000);
  }

  function flashBtn() {
    btnWrap.style.opacity = '1';
    btnWrap.style.animation = '__talox_bounce 0.35s ease';
    if (btnHideTimer) clearTimeout(btnHideTimer);
    btnHideTimer = setTimeout(function() {
      btnWrap.style.animation = 'none';
      btnWrap.style.opacity = '0';
    }, 2500);
  }

  // ─── Cursor functions (called from Node.js via page.evaluate) ─────────────
  window.__talox_cursor_move = function(x, y) {
    addTrailPoint(cursorX, cursorY);
    cursorX = x; cursorY = y;
    cursorEl.style.left = x + 'px';
    cursorEl.style.top  = y + 'px';
    spinnerEl.style.left = x + 'px';
    spinnerEl.style.top  = y + 'px';
  };

  window.__talox_cursor_click = function(x, y) {
    // Shrink + ripple
    cursorEl.style.transform = 'rotate(-35deg) scale(0.6)';
    setTimeout(function() {
      cursorEl.style.transform = 'rotate(-35deg) scale(1)';
      // Ripple element
      var ripple = document.createElement('div');
      applyAttrs(ripple, { 'aria-hidden': 'true', role: 'presentation' });
      applyStyle(ripple, {
        position: 'fixed', borderRadius: '50%',
        border: '2px solid ' + CYAN,
        left: x + 'px', top: y + 'px',
        marginLeft: '-0px', marginTop: '-0px',
        pointerEvents: 'none', zIndex: Z_CURSOR,
        animation: '__talox_ripple 0.45s ease-out forwards',
      });
      document.documentElement.appendChild(ripple);
      setTimeout(function() { if (ripple.parentElement) ripple.parentElement.removeChild(ripple); }, 500);
    }, 80);
  };

  window.__talox_cursor_think = function() {
    // Show spinner orbiting cursor
    applyStyle(spinnerEl, {
      opacity: '0.8',
      animation: 'none',
    });
    // Force reflow then start animation
    void spinnerEl.offsetWidth;
    spinnerEl.style.animation = '__talox_orbit 1s linear infinite';
  };

  window.__talox_cursor_act = function() {
    // Hide spinner
    spinnerEl.style.opacity = '0';
    setTimeout(function() { spinnerEl.style.animation = 'none'; }, 300);
  };

  window.__talox_cursor_hide = function() {
    cursorEl.style.opacity = '0';
    spinnerEl.style.opacity = '0';
    for (var i = 0; i < trailEls.length; i++) trailEls[i].style.opacity = '0';
    trailPoints = [];
  };

  window.__talox_cursor_sweep_in = function(targetX, targetY) {
    // Determine nearest edge
    var vw = window.innerWidth, vh = window.innerHeight;
    var edges = [
      { x: -20,       y: targetY,  dist: targetX },
      { x: vw + 20,   y: targetY,  dist: vw - targetX },
      { x: targetX,   y: -20,      dist: targetY },
      { x: targetX,   y: vh + 20,  dist: vh - targetY },
    ];
    edges.sort(function(a, b) { return a.dist - b.dist; });
    var edge = edges[0];

    cursorX = edge.x; cursorY = edge.y;
    cursorEl.style.left = edge.x + 'px';
    cursorEl.style.top  = edge.y + 'px';
    cursorEl.style.transition = 'none';
    cursorEl.style.opacity = '1';
    spinnerEl.style.opacity = '0';

    // Animate to target
    void cursorEl.offsetWidth; // reflow
    cursorEl.style.transition = 'left 600ms cubic-bezier(0.25,0.46,0.45,0.94), top 600ms cubic-bezier(0.25,0.46,0.45,0.94)';
    cursorEl.style.left = targetX + 'px';
    cursorEl.style.top  = targetY + 'px';
    cursorX = targetX; cursorY = targetY;
  };

  window.__talox_agent_running  = setAgentRunning;
  window.__talox_agent_paused   = setAgentPaused;

  // ─── Button click handlers ────────────────────────────────────────────────
  btnEl.addEventListener('click', function(e) {
    e.stopPropagation();
    if (isAgentRunning) {
      if (typeof window.__taloxEmit__ === 'function') {
        window.__taloxEmit__('takeover:request', {});
      }
    } else {
      if (typeof window.__taloxEmit__ === 'function') {
        window.__taloxEmit__('takeover:resume', {});
      }
    }
  });

  // ─── Mount ────────────────────────────────────────────────────────────────
  if (document.documentElement) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();
`;

// ─── TakeoverBridge ──────────────────────────────────────────────────────────

export class TakeoverBridge {
  private state: TakeoverState = 'AGENT_RUNNING';
  private readonly eventBus: EventBus<TaloxEventMap>;
  private readonly timeoutMs: number;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCursorPos = { x: 400, y: 300 };
  private headed = false;
  private currentPage: Page | null = null;

  constructor(eventBus: EventBus<TaloxEventMap>, timeoutMs = 120_000) {
    this.eventBus = eventBus;
    this.timeoutMs = timeoutMs;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Initialize the agent overlay for a given page.
   * Call once per page object. Safe to re-call with a new page.
   * Only injects when headed=true.
   */
  async initialize(page: Page, headed: boolean): Promise<void> {
    this.headed = headed;
    this.currentPage = page;

    if (!headed) return; // headless: no overlay

    // 1. Inject overlay bundle — persists across ALL navigations
    await page.addInitScript(AGENT_OVERLAY_SCRIPT);

    // 2. Wire browser → Node.js bridge (persists across navigations)
    try {
      await page.exposeFunction('__taloxAgentBridge__', this.handleBridgeEvent.bind(this));
    } catch {
      // Already exposed on this page object — ignore
    }

    // Patch the overlay to use our bridge
    await page.addInitScript(`
      (function() {
        var _orig = window.__taloxEmit__;
        window.__taloxEmit__ = function(type, payload) {
          if (typeof window.__taloxAgentBridge__ === 'function') {
            window.__taloxAgentBridge__(type, payload);
          }
          if (typeof _orig === 'function') _orig(type, payload);
        };
      })();
    `);

    // 3. Subscribe to EventBus events
    this.eventBus.on('humanTakeoverRequested', () => void this.onTakeoverRequested());
    this.eventBus.on('agentResumed',           (e) => void this.onAgentResumed(e.reason));
    this.eventBus.on('cursorMoved',            (e) => void this.onCursorMoved(e.x, e.y));
    this.eventBus.on('cursorClicked',          (e) => void this.onCursorClicked(e.x, e.y));
    this.eventBus.on('agentThinking',          () => void this.onAgentThinking());
    this.eventBus.on('agentActing',            () => void this.onAgentActing());
  }

  /**
   * Returns a CursorStepCallback that ActionExecutor can pass to HumanMouse.
   * When called per path step, it updates the fake cursor overlay.
   */
  getCursorStepCallback(): CursorStepCallback | undefined {
    if (!this.headed || !this.currentPage) return undefined;
    const page = this.currentPage;
    return async (x: number, y: number) => {
      this.lastCursorPos = { x, y };
      this.eventBus.emit('cursorMoved', { x, y });
      try {
        await page.evaluate(([px, py]: [number, number]) => {
          if (typeof (window as any).__talox_cursor_move === 'function') {
            (window as any).__talox_cursor_move(px, py);
          }
        }, [x, y] as [number, number]);
      } catch { /* page navigated */ }
    };
  }

  /** Signal agent is paused (human has control). */
  async requestTakeover(reason?: string): Promise<void> {
    const payload: { timestamp: string; reason?: string } = {
      timestamp: new Date().toISOString(),
    };
    if (reason !== undefined) payload.reason = reason;
    this.eventBus.emit('humanTakeoverRequested', payload as any);
  }

  /** Signal agent is resuming. */
  resumeAgent(): void {
    this.eventBus.emit('agentResumed', { reason: 'manual' });
  }

  getState(): TakeoverState {
    return this.state;
  }

  // ─── EventBus handlers ────────────────────────────────────────────────────

  private async onTakeoverRequested(): Promise<void> {
    this.state = 'WAITING_FOR_HUMAN';
    await this.evalOverlay('window.__talox_agent_paused?.()');
    if (this.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.eventBus.emit('agentResumed', { reason: 'timeout' });
      }, this.timeoutMs);
    }
  }

  private async onAgentResumed(reason: string): Promise<void> {
    this.state = 'AGENT_RUNNING';
    if (this.timeoutTimer) { clearTimeout(this.timeoutTimer); this.timeoutTimer = null; }
    const { x, y } = this.lastCursorPos;
    await this.evalOverlay(
      `window.__talox_cursor_sweep_in?.(${x}, ${y}); window.__talox_agent_running?.();`
    );
  }

  private async onCursorMoved(x: number, y: number): Promise<void> {
    this.lastCursorPos = { x, y };
    // Already handled directly in getCursorStepCallback for performance.
    // This handler exists for external callers who emit cursorMoved without using the callback.
    if (!this.currentPage) return;
    try {
      await this.currentPage.evaluate(([px, py]: [number, number]) => {
        if (typeof (window as any).__talox_cursor_move === 'function') {
          (window as any).__talox_cursor_move(px, py);
        }
      }, [x, y] as [number, number]);
    } catch { /* page navigated */ }
  }

  private async onCursorClicked(x: number, y: number): Promise<void> {
    await this.evalOverlay(`window.__talox_cursor_click?.(${x}, ${y})`);
  }

  private async onAgentThinking(): Promise<void> {
    await this.evalOverlay('window.__talox_cursor_think?.()');
  }

  private async onAgentActing(): Promise<void> {
    await this.evalOverlay('window.__talox_cursor_act?.()');
  }

  // ─── Browser → Node.js bridge ────────────────────────────────────────────

  private handleBridgeEvent(type: string, _payload: unknown): void {
    switch (type) {
      case 'takeover:request':
        void this.requestTakeover('User clicked Take Over button');
        break;
      case 'takeover:resume':
        this.resumeAgent();
        break;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async evalOverlay(js: string): Promise<void> {
    if (!this.currentPage || !this.headed) return;
    try {
      await this.currentPage.evaluate(js);
    } catch { /* page navigated or closed */ }
  }
}
