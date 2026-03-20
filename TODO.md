# Talox v2 — Task List

> Architecture, vision, and full technical spec: see [`docs/TALOX-V2-SPEC.md`](docs/TALOX-V2-SPEC.md)

---

## ⚠️ LESSONS FROM FAILED FIRST ATTEMPT — READ BEFORE TOUCHING CODE

The previous agent made 5 critical mistakes. Do not repeat them.

### Mistake 1: Skipped Phase 1 entirely
The agent jumped straight to building features without doing branch unification.
Phase 1 is NOT optional. Do it first. The `v2` branch is currently a mess built on the wrong base.

### Mistake 2: Used `page.evaluate()` for overlay injection
`page.evaluate()` runs ONCE. When the user navigates to a new page, the overlay is GONE.
**The correct Playwright API:** `page.addInitScript()` — runs automatically on EVERY navigation.
**Also correct:** `page.exposeFunction()` — persists across navigations (the agent got this right for bindings).
**Fix:** Inject the overlay HTML+CSS via `page.addInitScript()`, NOT `page.evaluate()`.

### Mistake 3: Invented a "fake cursor" — conceptually wrong
In **headed** Playwright, `page.mouse.move()` (used inside HumanMouse) moves the **real OS cursor**.
You can literally see it in the browser window. A CSS fake cursor is:
- Redundant (real cursor already moves with HumanMouse)
- Breaks things (CSS `cursor: none` hid the real cursor on some pages)
- Impossible to sync correctly (CSS position ≠ Playwright mouse position)

In **headless**, there is no visible cursor — that's fine, agents don't need to see it.

**Fix:** DELETE the fake cursor entirely. It should never have been built. The overlay only needs:
1. The glow border (agent-running state)
2. The "⏸ Take Over" / "▶ Resume Agent" button

### Mistake 4: Duplicate CSS in overlay — broken cursor
The `#__talox-fake-cursor` selector appears TWICE in the same `<style>` block (lines 103-116 AND 155-169)
with completely different and contradictory rules. Second block wins. This is why the cursor had a
"weird asymmetrical shape" — the triangle CSS was overriding the arrow CSS.

### Mistake 5: Mode system was never removed
Phase 2 (remove TaloxMode, ModeManager, etc.) was never completed.
The old type system is still intact. Don't build anything on top of the broken foundation.

---

## CLEANUP BEFORE STARTING

- [ ] Delete all untracked `*.mjs` demo scripts in project root (there are ~13 of them)
- [ ] The current `v2` branch is based on the wrong commits — **reset it or start fresh**
- [ ] Delete `src/core/controller/TakeoverBridge.ts` — the current version is broken (see mistakes above). It will be rebuilt correctly in Phase 4.

---

## PHASE 1 — Branch Unification (MANDATORY FIRST)

- [ ] Read `test-extension` branch — read all files vs main, decide: cherry-pick useful commits or discard
- [ ] Read `automation/overnight-audit-20260319` and `automation/overnight-audit-20260319-main-fix` — read changes vs main, decide: cherry-pick or discard
- [ ] Create fresh `v2` branch from `main` (if current v2 is too dirty, force-reset it to main)
- [ ] Cherry-pick `5b34212` from `bug-investigation/talox-tests` — stealth browser + mouse movement fix
- [ ] Cherry-pick `d6df906`, `1accc29`, and the overlay-end fix commit from `talox-harbor`
- [ ] Cherry-pick CI configs from `talox-harbor`: `3b51b76`, `cced2c6`
- [ ] Cherry-pick headed mode support + auto-escalation logic from `experimental/real-world-tests` (read commits carefully, cherry-pick core logic only — skip any test-runner-only changes)
- [ ] Discard: all Agent-First model work from `talox-harbor` (ModeManager.ts, the big TaloxController rewrite, types/modes.ts additions)

---

## PHASE 2 — Remove Mode System

- [ ] Delete `src/types/modes.ts`
- [ ] Delete `src/core/controller/ModeManager.ts`
- [ ] Create `src/types/settings.ts` with `TaloxSettings` interface + `DEFAULT_SETTINGS` (see spec)
- [ ] Create `src/types/config.ts` with `TaloxConfig` interface (see spec)
- [ ] Rewrite `src/types/index.ts` — new exports only, no mode exports
- [ ] Grep for: `TaloxMode|ModeManager|resolveMode|CANONICAL_MODES|MODE_PRESETS` — must be zero hits after this phase

---

## PHASE 3 — Rewrite TaloxController

- [ ] Rewrite constructor: merge `DEFAULT_SETTINGS` + user config, no mode system
- [ ] Remove `setMode()`, `getMode()`, `override()`, all Agent-First methods
- [ ] Add `setVerbosity(level: 0|1|2|3): void` — agent calls at runtime; also expose as LLM tool in TaloxTools.ts
- [ ] Add `getDebugSnapshot(): Promise<DebugSnapshot>` — pull state + recent events on demand
- [ ] Add `setHeaded(headed: boolean): Promise<void>` — force browser to headed/headless at any time
- [ ] Add `requestHumanTakeover(reason?: string): Promise<void>` — freeze agent, trigger overlay change
- [ ] Add `resumeAgent(): void` — human gives control back
- [ ] Add `onTakeover()` / `onAgentResumed()` event hooks
- [ ] Implement takeover state machine: `AGENT_RUNNING → WAITING_FOR_HUMAN → AGENT_RUNNING`
- [ ] Implement auto-resume timer: fires after `humanTakeoverTimeoutMs` ms; skip if 0

---

## PHASE 3b — Auto Headed/Headless Escalation

- [ ] Add `autoHeadedEscalation: true` to `DEFAULT_SETTINGS`
- [ ] Add `escalate_to_headed` strategy to `AdaptationEngine` / `strategies.ts`
  - Trigger: blocker detected that cannot be solved headlessly
  - Action: save current URL + cookies → relaunch browser headed → restore state → continue
  - Emit: `headedEscalation` event with reason string
- [ ] Add `de_escalate_to_headless` strategy: when blocker resolved → save state → relaunch headless → continue
  - Emit: `headlessRestored` event
- [ ] Session state (cookies, localStorage, URL, scroll position) must survive relaunch — wire through `ProfileVault` + `SessionManager`
- [ ] If `observe: true`: bypass escalation entirely, always headed

---

## PHASE 4 — Human Takeover Overlay UI (rebuild from scratch, correctly)

**CRITICAL: Read the "what went wrong" notes at top of this file before starting this phase.**

### How to inject correctly (use these exact Playwright APIs):
```typescript
// CORRECT — persists across ALL navigations:
await page.addInitScript(() => {
  // inject overlay HTML+CSS here
  // this runs on EVERY page load automatically
});

// CORRECT — persists across ALL navigations:
await page.exposeFunction('__talox_requestTakeover', handler);
await page.exposeFunction('__talox_resumeAgent', handler);

// WRONG — only runs once, gone after navigation:
await page.evaluate(() => { /* inject stuff */ });
```

### Tasks:
- [ ] Delete current `src/core/controller/TakeoverBridge.ts`
- [ ] Create new `src/core/controller/TakeoverBridge.ts` with:
  - `initialize(page)` calls `page.addInitScript(injectOverlayHTML)` for persistence
  - `initialize(page)` calls `page.exposeFunction()` for button click bindings (already correct in old version — keep this pattern)
  - **NO fake cursor** — delete all cursor code. The overlay has exactly TWO elements:
    1. `#__talox-overlay` div: `position:fixed, inset:0, pointer-events:none, z-index:999999` — the glow frame
    2. `#__talox-takeover-btn` button: `position:fixed, bottom:20px, left:50%, transform:translateX(-50%)` — the button

- [ ] Glow styles:
  - Agent running: `box-shadow: inset 0 0 0 3px rgba(0,212,255,0.6)` (solid thin border, pulsing animation)
  - Waiting for human: remove glow entirely (user is in control, no visual noise)

- [ ] Button styles:
  - Agent running state: `⏸ Take Over` — cyan background
  - Waiting state: `▶ Resume Agent` — amber/orange background
  - If countdown: `▶ Resume Agent (1:47)` — updated every second

- [ ] Overlay only injected when `humanTakeoverEnabled: true` AND `headed: true`
  - Headless: never inject overlay (no window to show it in)
  - If headed but `humanTakeoverEnabled: false`: no overlay

- [ ] The button click handler must use `window.__talox_requestTakeover()` / `window.__talox_resumeAgent()` which route to Node.js via `exposeFunction`

- [ ] Handle `page` replacement: when `SessionManager` creates a new page (e.g. headed→headless escalation), call `bridge.reinitialize(newPage)` which re-runs `addInitScript` + `exposeFunction` on the new page object

---

## PHASE 5 — Always-On Capability Modules

- [ ] `AdaptationEngine.ts` — remove any mode gate, always armed
- [ ] `BotDetector.ts` — remove any mode gate, always scanning
- [ ] `ActionExecutor.ts` — always use `HumanMouse` for all mouse interactions, no bypass path except `settings.humanStealth === 0`
- [ ] `RulesEngine.ts` — always run bug detection; verbosity 0 = collect silently, verbosity 1+ = emit events live
- [ ] `PageStateCollector.ts` — remove any `perceptionDepth: 'shallow'` path, always collect full AX-tree + DOM + console + network

---

## PHASE 6 — Tests

- [ ] Delete `tests/core/controller/ModeManager.test.ts` (mode system gone)
- [ ] Delete `tests/core/controller/modes.test.ts` (mode system gone)
- [ ] Create `tests/unit/TaloxController.test.ts`:
  - Default construction: all settings match DEFAULT_SETTINGS
  - `setVerbosity()` changes emission behavior
  - `observe: true` forces headed + wires ObserveSession
  - Takeover state machine: request → waiting → resume → running
  - Takeover state machine: request → waiting → timeout → auto-resume
  - Takeover timeout=0: stays waiting until explicit resumeAgent()
- [ ] Create `tests/unit/settings.test.ts`:
  - DEFAULT_SETTINGS has all required fields with correct defaults
  - Partial override merges correctly
  - `humanTakeover: true` → `humanTakeoverEnabled: true`
  - `humanTakeover: { timeoutMs: 60000 }` → correct timeout value
- [ ] Create `tests/unit/TakeoverBridge.test.ts`:
  - `addInitScript` called on initialize (not `evaluate`)
  - `exposeFunction` called for both bindings
  - Overlay not injected in headless mode
  - Overlay not injected when `humanTakeoverEnabled: false`
  - State transitions correctly on `humanTakeoverRequested` / `agentResumed` events
- [ ] Move real-world test suite from `experimental/real-world-tests` branch into `tests/real/`

---

## PHASE 7 — Public Exports

- [ ] Rewrite `src/index.ts`: export `TaloxController`, `TaloxConfig`, `TaloxSettings`, `DEFAULT_SETTINGS`, event types, `ObserveSession`

---

## PHASE 8 — Documentation

- [ ] Update `docs/TALOX-SPEC.md` — new intro, remove mode section, add takeover + verbosity reference
- [ ] Update `docs/TALOX-ARCHITECTURE.md` — remove ModeManager, add TakeoverBridge (rebuilt), clarify no fake cursor
- [ ] Archive `docs/TALOX-AGENT-FIRST-REARCHITECTURE.md` (move to `docs/archive/`)
- [ ] Bump `package.json` version to `2.0.0`

---

## PHASE 9 — Final Validation

- [ ] `npm run typecheck` — zero TypeScript errors
- [ ] `npm run test` — all unit tests pass
- [ ] `npm run test:e2e` — all E2E fixture tests pass
- [ ] Grep for old mode system: `TaloxMode|ModeManager|resolveMode|CANONICAL_MODES|MODE_PRESETS` — zero results
- [ ] Grep for fake cursor: `fake-cursor|fakeCursor|__talox-fake-cursor` — zero results
- [ ] Grep for `page.evaluate` inside TakeoverBridge — must be zero (all overlay injection uses `addInitScript`)
- [ ] Real-world tests (optional, needs network): `npm run test:real`
