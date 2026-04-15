/**
 * @file TakeoverBridge.ts
 * @description Agent overlay — glow border + human takeover UI.
 *
 * Active whenever `humanTakeoverEnabled: true` and `headed: true`.
 * Injects a self-contained JavaScript overlay via `page.addInitScript()`
 * (persists across ALL navigations).
 *
 * No fake cursor. No click blocker. No synthetic mouse tracking.
 *
 * Visual states:
 *   AGENT_RUNNING     — cyan glow border, "⏸ Take Over" button (auto-hides on idle)
 *   WAITING_FOR_HUMAN — glow off, "▶ Resume Agent" button always visible
 *
 * Playwright API rules:
 *   Overlay injection   → page.addInitScript()   (persists across navigations)
 *   Browser → Node.js   → page.exposeFunction()  (persists across navigations)
 *   Node.js → Browser   → page.exposeFunction() + __talox_cmd__ dispatcher
 */

import type { Page } from "playwright";
import type { TakeoverReason, TakeoverSummary, TaloxEventMap } from "../../types/events.js";
import type { EventBus } from "./EventBus.js";

export type TakeoverState = "AGENT_RUNNING" | "WAITING_FOR_HUMAN";
export type { TakeoverReason, TakeoverSummary };

// ─── Agent Overlay Bundle (injected into every page) ─────────────────────────

/**
 * Self-contained JavaScript string injected via page.addInitScript().
 * All elements carry aria-hidden="true" so the agent's AX-tree never sees them.
 *
 * Listens for commands via `window.__taloxCmd__(name)` exposed from Node.js.
 */
const AGENT_OVERLAY_SCRIPT = /* js */ `
(function() {
  if (window.__taloxOverlay__) return; // idempotent guard
  window.__taloxOverlay__ = true;

  var CYAN      = '#00D4FF';
  var CYAN_GLOW = 'rgba(0, 212, 255, 0.55)';
  var Z_GLOW    = 999997;
  var Z_BUTTON  = 1000000;

  var isAgentRunning = true;
  var btnHideTimer = null;

  // ─── DOM Elements ─────────────────────────────────────────────────────────
  var style   = document.createElement('style');
  var glowEl  = document.createElement('div');
  var btnWrap = document.createElement('div');
  var btnEl   = document.createElement('button');

  style.textContent = [
    '@keyframes __talox_pulse { 0%,100%{opacity:.35} 50%{opacity:.65} }',
    '@keyframes __talox_bounce { 0%,100%{transform:translateX(-50%) scale(1)} 40%{transform:translateX(-50%) scale(1.12)} 70%{transform:translateX(-50%) scale(0.96)} }',
  ].join('');

  function applyStyle(el, styles) {
    Object.assign(el.style, styles);
  }

  // Glow border
  glowEl.id = '__talox-glow';
  glowEl.setAttribute('aria-hidden', 'true');
  glowEl.setAttribute('role', 'presentation');
  applyStyle(glowEl, {
    position: 'fixed', inset: '0', pointerEvents: 'none',
    zIndex: Z_GLOW, boxSizing: 'border-box',
    boxShadow: 'inset 0 0 0 3px ' + CYAN_GLOW,
    animation: '__talox_pulse 2s ease-in-out infinite',
    opacity: '0.35',
  });

  // Takeover/Resume button wrapper
  btnWrap.id = '__talox-btn-wrap';
  btnWrap.setAttribute('aria-hidden', 'true');
  btnWrap.setAttribute('role', 'presentation');
  applyStyle(btnWrap, {
    position: 'fixed', bottom: '20px', left: '50%',
    transform: 'translateX(-50%)',
    zIndex: Z_BUTTON, pointerEvents: 'auto',
    opacity: '0', transition: 'opacity 0.25s ease',
  });

  btnEl.id = '__talox-btn';
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

  // ─── State transitions ──────────────────────────────────────────────────
  function setAgentRunning() {
    isAgentRunning = true;
    applyStyle(glowEl, {
      boxShadow: 'inset 0 0 0 3px ' + CYAN_GLOW,
      animation: '__talox_pulse 2s ease-in-out infinite',
      opacity: '0.35', display: 'block',
    });
    btnEl.textContent = '⏸ Take Over';
    applyStyle(btnEl, { background: 'rgba(0,212,255,0.9)', color: '#000' });
    // Button auto-hides when agent runs; appears on mousemove
    applyStyle(btnWrap, { opacity: '0', transition: 'opacity 0.25s ease' });
  }

  function setAgentPaused() {
    isAgentRunning = false;
    applyStyle(glowEl, { animation: 'none', opacity: '0' });
    btnEl.textContent = '▶ Resume Agent';
    applyStyle(btnEl, { background: 'rgba(255,170,0,0.95)', color: '#000' });
    applyStyle(btnWrap, { opacity: '1', transition: 'opacity 0.3s ease' });
    if (btnHideTimer) { clearTimeout(btnHideTimer); btnHideTimer = null; }
  }

  // ─── Button visibility ──────────────────────────────────────────────────
  function showBtn() {
    if (!isAgentRunning) return;
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

  // ─── Command dispatcher (called from Node.js) ───────────────────────────
  // Exposed via page.exposeFunction('__taloxCmd__', ...) from Node.js.
  // This allows Node.js→Browser state updates without page.evaluate().
  window.__taloxDispatch__ = function(cmd) {
    switch (cmd) {
      case 'agent_running':  setAgentRunning();  break;
      case 'agent_paused':   setAgentPaused();   break;
    }
  };

  // ─── Button click handlers ──────────────────────────────────────────────
  btnEl.addEventListener('click', function(e) {
    e.stopPropagation();
    if (typeof window.__taloxBridge__ === 'function') {
      window.__taloxBridge__(isAgentRunning ? 'takeover:request' : 'takeover:resume', {});
    }
  });

  // Show button on mousemove (when agent is running)
  document.addEventListener('mousemove', function() {
    if (isAgentRunning) showBtn();
  }, { passive: true });

  // ─── Mount ──────────────────────────────────────────────────────────────
  function mount() {
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(glowEl);
    document.documentElement.appendChild(btnWrap);
    setAgentRunning();
  }

  if (document.documentElement) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})();
`;

// ─── TakeoverBridge ──────────────────────────────────────────────────────────

/**
 * Manages the bidirectional bridge between the agent and a human operator
 * in headed mode. Injects a persistent browser overlay (cyan glow border,
 * Take Over / Resume button) and coordinates state transitions between
 * `AGENT_RUNNING` and `WAITING_FOR_HUMAN` via EventBus and exposed functions.
 */
export class TakeoverBridge {
	private state: TakeoverState = "AGENT_RUNNING";
	private readonly eventBus: EventBus<TaloxEventMap>;
	private readonly timeoutMs: number;
	private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
	private headed = false;
	private currentPage: Page | null = null;
	private takeoverStartedAt: string | null = null;
	private takeoverReason: TakeoverReason | string | undefined = undefined;

	constructor(eventBus: EventBus<TaloxEventMap>, timeoutMs = 120_000) {
		this.eventBus = eventBus;
		this.timeoutMs = timeoutMs;
	}

	// ─── Public API ────────────────────────────────────────────────────────────

	/**
	 * Initialize the agent overlay for a given page.
	 * Only injects when headed=true. Safe to re-call with a new page (SessionManager swaps).
	 */
	async initialize(page: Page, headed: boolean): Promise<void> {
		this.headed = headed;
		this.currentPage = page;

		if (!headed) return; // headless: no overlay

		// 1. Inject overlay bundle — persists across ALL navigations
		await page.addInitScript(AGENT_OVERLAY_SCRIPT);

		// 2. Wire browser → Node.js bridge (persists across navigations)
		try {
			await page.exposeFunction("__taloxBridge__", this.handleBridgeEvent.bind(this));
		} catch {
			// Already exposed on this page object — safe to ignore
		}

		// 3. Wire Node.js → Browser command channel
		//    The overlay already defined window.__taloxDispatch__ in its init script.
		//    We re-expose it here so we can call it from Node.js via the function handle.
		try {
			// Expose a no-op placeholder so exposeFunction registers the name;
			// actual dispatch is handled by window.__taloxDispatch__ in the overlay.
			await page.exposeFunction("__taloxCmd__", (_cmd: string) => {
				// no-op: used only as the bridge target name
			});
		} catch {
			// Already registered
		}

		// 4. Subscribe to EventBus events
		this.eventBus.on("humanTakeoverRequested", () => void this.onTakeoverRequested());
		this.eventBus.on("agentResumed", (e) => void this.onAgentResumed(e.reason));
	}

	/**
	 * Re-initialize overlay bindings for a new page (called when SessionManager swaps pages).
	 */
	async reinitialize(page: Page): Promise<void> {
		return this.initialize(page, this.headed);
	}

	/** Signal agent is paused (human has control). */
	async requestTakeover(reason?: TakeoverReason | string): Promise<void> {
		const timestamp = new Date().toISOString();
		this.takeoverReason = reason;
		this.takeoverStartedAt = timestamp;
		const payload: { timestamp: string; reason?: TakeoverReason | string } = { timestamp };
		if (reason !== undefined) payload.reason = reason;
		this.eventBus.emit("humanTakeoverRequested", payload);
	}

	/** Signal agent is resuming after human takeover. */
	resumeAgent(): void {
		const summary = this.buildSummary("manual");
		const payload: { reason: "manual"; summary?: TakeoverSummary } = { reason: "manual" };
		if (summary) payload.summary = summary;
		this.eventBus.emit("agentResumed", payload);
	}

	getState(): TakeoverState {
		return this.state;
	}

	// ─── EventBus handlers ────────────────────────────────────────────────────

	private async onTakeoverRequested(): Promise<void> {
		this.state = "WAITING_FOR_HUMAN";
		// Register timeout before awaiting overlay update so fake-timer tests work correctly
		if (this.timeoutMs > 0) {
			this.timeoutTimer = setTimeout(() => {
				const summary = this.buildSummary("timeout");
				const payload: { reason: "timeout"; summary?: TakeoverSummary } = { reason: "timeout" };
				if (summary) payload.summary = summary;
				this.eventBus.emit("agentResumed", payload);
			}, this.timeoutMs);
		}
		await this.dispatchCmd("agent_paused");
	}

	private async onAgentResumed(_reason: string): Promise<void> {
		this.state = "AGENT_RUNNING";
		if (this.timeoutTimer) {
			clearTimeout(this.timeoutTimer);
			this.timeoutTimer = null;
		}
		this.takeoverStartedAt = null;
		this.takeoverReason = undefined;
		await this.dispatchCmd("agent_running");
	}

	// ─── Browser → Node.js bridge ────────────────────────────────────────────

	private handleBridgeEvent(type: string, _payload: unknown): void {
		switch (type) {
			case "takeover:request":
				void this.requestTakeover("User clicked Take Over button");
				break;
			case "takeover:resume":
				this.resumeAgent();
				break;
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private buildSummary(endReason: "manual" | "timeout"): TakeoverSummary | undefined {
		if (!this.takeoverStartedAt) return undefined;
		const resumedAt = new Date().toISOString();
		return {
			reason: this.takeoverReason ?? "manual",
			startedAt: this.takeoverStartedAt,
			resumedAt,
			durationMs: new Date(resumedAt).getTime() - new Date(this.takeoverStartedAt).getTime(),
			timedOut: endReason === "timeout",
		};
	}

	/**
	 * Dispatch a command to the browser overlay via window.__taloxDispatch__.
	 * Uses page.evaluate only for these rare state-transition calls
	 * (not per-frame, not in hot paths).
	 */
	private async dispatchCmd(cmd: "agent_running" | "agent_paused"): Promise<void> {
		if (!this.currentPage || !this.headed) return;
		try {
			await this.currentPage.evaluate((c: string) => {
				(window as any).__taloxDispatch__?.(c);
			}, cmd);
		} catch {
			/* page navigated or closed */
		}
	}
}
