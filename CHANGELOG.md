# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2026-04-15

### Breaking Changes

- **Constructor signature change** — `TaloxController` now accepts `(baseDirOrConfig, config?)`. The first argument can be either a `string` (base directory) or a `TaloxConfig` object. This means `new TaloxController({ headless: true })` now works as expected.
- **Wildcard export removed** — `BrowserManager` internal symbols (`DEFAULT_CONFIG`, `getDefaultConfig`, `resolveConfigDir`, `createLiveBootManager`, `printBrowserInstallGuide`) are no longer exported. Import `BrowserManager` and `BrowserType` explicitly.

### Added

- **FingerprintGenerator** — Deterministic, OS-consistent browser fingerprint profiles:
  - Market-share-weighted OS selection (Windows 72%, macOS 17%, Linux 4%)
  - All attributes (UA, platform, WebGL, audio, fonts, hardware, battery, timezone) consistent per OS
  - Deterministic generation from seed for replayable sessions
  - Cross-validator that detects OS/UA, OS/GPU, hardware inconsistencies
- **13-layer stealth injection** (upgraded from 6):
  - Platform, `hardwareConcurrency`, `deviceMemory` spoofing (consistent with OS)
  - AudioContext `sampleRate`/`maxChannelCount`/`outputLatency` (OS-consistent)
  - Battery API spoofing, WebRTC leak prevention
  - Font metrics fingerprint defense (letter-spacing noise)
  - Timezone consistency via `Intl.DateTimeFormat` override
  - All values sourced from unified `FingerprintProfile` (no random drift between attributes)
- **`EventBus` exported** — Advanced consumers can now use typed event subscriptions
- **15 new unit tests** for FingerprintGenerator (generation, determinism, consistency, validation)

### Fixed

- **CRITICAL: Duplicate `TaloxConfig` leak** — Wildcard export from `BrowserManager` leaked an internal `TaloxConfig` that conflicted with the public `TaloxConfig` from `types/config.ts`. Replaced with selective exports.
- **HIGH: `launch()` partial failure leak** — If takeover initialization failed after browser launch, the browser was left running. Now properly cleaned up.
- **HIGH: Auto-thinking process crash** — Unhandled rejection in `setInterval` could crash the process. Now caught with `.catch()`.
- **HIGH: `requestTakeover` unhandled rejection** — `void` on async call discarded the Promise. Now uses `.catch()`.
- **MEDIUM: Snapshot restore fallback** — After a failed snapshot restore during headed/headless switch, now navigates to the last-known URL instead of leaving the page on `about:blank`.
- **MEDIUM: `stop()` safety** — Wrapped in try/catch for safe cleanup in finally blocks.
- **MEDIUM: Null page checks** — `waitForSelector`/`waitForNavigation` now throw descriptive errors when no page is active.
- **Constructor flexibility** — `new TaloxController({ headless: true })` now works (previously required `new TaloxController(".", { headless: true })`).
- **Removed dead legacy shim** (`src/core/TaloxController.ts`) that said "will be removed in v2.0".
- **Biome lint fixes** across 6 files.

### Removed

- Internal `DEFAULT_CONFIG`, `getDefaultConfig()`, `resolveConfigDir()`, `createLiveBootManager()`, `printBrowserInstallGuide()` from public exports.
- Legacy shim `src/core/TaloxController.ts`.

## [3.0.0] - 2026-04-10

### Breaking Changes

- **Version bumped from 2.0.0** — major version signals significant architectural additions and public API surface changes since v2.

### Added

- **State Contract v1** — `TaloxPageState` frozen as a versioned public contract with compatibility policy. Every core action returns the full contract: AX tree, interactive elements, console errors, failed requests, visual artifacts, bug findings, and timing metadata.
- **Compact state variants** — `getState('full')`, `getState('agent')`, `getState('debug')` for token-efficient LLM context. The `agent` variant targets >5x token reduction.
- **Challenge Detection Engine** — `ChallengeDetector` classifies 10 challenge types: cloudflare, captcha, verification, login-wall, consent-wall, age-gate, maintenance, geo-block, rate-limited, empty-shell-spa.
- **Challenge Resolver** — Local-only fallback flows: wait-and-settle, backoff-retry, auto-click-accept, wait-hydration per challenge type.
- **Human takeover system** — Typed `TakeoverReason` union (`login-required`, `2fa-required`, `captcha-present`, `agent-uncertain`, `policy-blocked`, `challenge-unsolved`), timeout policies (wait forever, auto-resume, abort), and instant resume via `SessionSnapshot` capture/restore across browser restarts.
- **Interaction reliability engine** — 9 failure-pattern recovery strategies (sticky headers, animated menus, delayed hydration, shifting buttons, modal stacks, nested scroll containers, iframe login boxes, React portals, virtualized lists).
- **Perception layer** — `PerceptionStack` with cheap/medium/heavy presets and session-level caching.
- **Observation mode** — One-command `talox observe` CLI. Generates per-session reports with timeline, screenshots, event log, console/network failures, annotations, DOM/AX diffs, and bug summaries in JSON/MD/HTML.
- **Adaptation engine with domain memory** — `DomainMemory` with EWMA per-hostname strategy scoring. `AdaptationEngine` learns which interaction strategies work per domain.
- **Self-healing selectors** — `SelfHealingSelector` tracks selector success rates and adapts broken selectors automatically.
- **Vision gate** — `VisionGate` for visual regression baselines, structural change detection, and OCR text extraction.
- **Session snapshot** — `SessionSnapshot` captures full browser state (cookies, localStorage, sessionStorage, scroll position, viewport) for instant state restore.
- **Policy engine** — Allowlist/blocklist URL guard with `PolicyEngine`.
- **Profile vault** — Persistent browser profiles via `ProfileVault`.
- **CLI** — `npx talox` CLI with `observe` command, preset selection, and browser lab mode.
- **Practical tools** — Download, wait, text extraction utilities in `src/tools/practical-tools.ts`.
- **Built-in presets** — `research`, `qa`, `gaming`, `browser-lab` profiles.
- **Semantic mapper** — AX-tree to structured semantic output via `SemanticMapper`.
- **Rules engine** — Per-domain interaction rules via `RulesEngine`.
- **Network mocker** — Request interception for testing via `NetworkMocker`.
- **Ghost visualizer** — Debug PNG overlay generator for forensic analysis.
- **Artifact builder** — Session artifact assembly with trace capture.
- **State diffs** — `TaloxStateDiff` type and `diffPageState()` pure function attached as `state.diff` on every action.
- **Compatibility policy** — `docs/TALOX-CONTRACTS.md` defines rules for `TaloxPageState` schema evolution.
- **AGENTS.md** — Agent-friendly project guide with structure, key concepts, and code health commands.
- **243 unit tests** across 14 test files, plus 94 browser integration tests across 16 files.

### Changed

- **CI modernized** — Node 22, separate lint+typecheck job, Playwright browsers installed for integration tests, 120s timeout for browser tests.
- **Test infrastructure** — Vitest workspace with separate configs for fast unit tests (5s timeout) and browser integration tests (120s timeout).
- **Build** — Zero TypeScript errors on strict mode.

### Fixed

- **`BrowserManager.ts` context tracking bug** — Close event handler had `this.context === this.context` (always true). Now correctly uses captured context reference to detect stale handles.
- **`BrowserManager.ts` fallback launch resource leak** — Fallback browser launch path never attached close handler, causing context registry leaks.
- **Dead import `ModeManager`** — Removed all references to deleted `ModeManager` module in test files.
- **Stale CI branches** — Removed `experimental/real-world-tests` and `talox-harbor` from workflow triggers, added `v3`.

---

## [2.0.0] - 2026-03-20

### Breaking Changes

- **No more modes** — `smart`, `speed`, `debug`, `observe` as constructor parameters are removed. The `TaloxController` constructor now takes `TaloxConfig` with `settings` and optional `observe: boolean` flag.
- **`launch()` signature changed** — no mode parameter. Old: `launch(id, class, mode)`. New: `launch(id, class, browserType?, observeOptions?)`.
- **`ModeManager` removed** — all mode-routing logic eliminated.
- **`setMode()` removed** — use `setVerbosity(0-3)` for runtime perception control instead.

### Added

- **Agent Overlay** — When `headed: true`, automatically injects a self-contained overlay via `page.addInitScript()` (persists across all navigations):
  - Cyan pulsing glow border (3px inset, breathing animation)
  - Fake cyan arrow cursor with Bezier comet trail (12-point fading history)
  - Spinner ring orbiting cursor during `think`/`fidget` states
  - Shrink + ripple click animation
  - Transparent click-blocker preventing accidental human interference
  - "⏸ Take Over" button: bottom-center, appears on mouse-enter, auto-hides after 5s idle

- **Human Takeover** — `requestHumanTakeover(reason?)` freezes agent, returns Promise that resolves on resume. `resumeAgent()` restores control. Auto-resume timer via `humanTakeoverTimeoutMs`.

- **Synthetic mouse events** — `HumanMouse` no longer moves OS cursor during path traversal. Only the final click position moves the real Playwright mouse. Fake cursor renders the full Bezier path visually.

- **`CursorStepCallback`** type exported from `HumanMouse` for custom cursor tracking integrations.

- **New events**: `agentThinking`, `agentActing`, `cursorClicked` added to `TaloxEventMap`.

- **`setVerbosity(0|1|2|3)`** — runtime verbosity control (not a mode). Level 0 = silent, 3 = full trace.

- **`getDebugSnapshot()`** — pull current state + recent events on demand at any verbosity level.

- **`getCursorStepCallback()`** on `TakeoverBridge` — returns a callback ActionExecutor passes to HumanMouse for per-step overlay updates.

- **`aria-hidden="true"`** on all overlay elements — agent's AX-tree never sees Talox UI elements.

### Changed

- **Everything always on** — HumanMouse, BotDetector, AdaptationEngine, full perception active by default, no mode required.

- **`TakeoverBridge`** rebuilt from scratch using correct Playwright APIs (`addInitScript` + `exposeFunction`). Previous version used `evaluate()` which reset on navigation.

- **`HumanMouse.move/click/fidget`** — new optional `onStep?: CursorStepCallback` parameter. When provided, skips intermediate `page.mouse.move()` calls (OS cursor stays still).

- **`ActionExecutor`** — emits `agentActing` before mouse actions, `agentThinking` before think/fidget, `cursorClicked` after every click.

- **Default settings** — `stealthLevel: 'high'`, `adaptiveStealthEnabled: true`, `humanStealth: 1.0`, `perceptionDepth: 'full'` — all default to maximum.

### Fixed

- **Overlay injection** — Fixed critical bug where overlay used `page.evaluate()` (reset on every navigation). Now uses `page.addInitScript()` which persists across all page loads.

- **Duplicate CSS selectors** — Previous `TakeoverBridge` had `#__talox-fake-cursor` defined twice with contradictory rules, causing broken cursor appearance.

---

## [1.3.0] - 2026-03-18

### Added

- **Bulletproof E2E test suite** — Playwright Test with local fixture server on port 9999, covering 3 surfaces: Agent Actions (37 tests), Observe Mode (14 tests), Smart Mode Adaptation (10 tests).
- **79 unit tests** across 6 new test files: `EventBus`, `ModeManager`, `modes`, `AnnotationBuffer`, `BotDetector`, `AdaptationEngine`.
- **`test:e2e`** and **`test:publish`** npm scripts. `test:publish` gates: TypeScript check → unit tests → E2E → production build.
- **`esbuild`** added as optional peer dependency (`>=0.17.0`) for OverlayInjector bundle support.
- **`TALOX_HEADLESS=false`** environment variable respected by `BrowserManager` for headed test sessions.
- **6 fixture HTML pages** in `tests/e2e/fixtures/pages/`: `form.html`, `captcha.html`, `rate-limit.html`, `shadow-dom.html`, `observe-target.html`, `multi-page.html`.

### Fixed

- **`findElement()` always returned null** — `TaloxController.findElement()` was not passing `lastState` to `ActionExecutor.findElement()`, which has an early return guard. Fixed: passes `this._session.lastState`.
- **`setAttentionFrame()` scoping broken** — same root cause as `findElement` (no `lastState`). Fixed in the same change.
- **Speed mode navigation slower than smart mode** — `waitUntil` ternary was inverted: speed mode was using `networkidle` (slowest) and other modes `load`. Fixed: speed mode now uses `domcontentloaded`, other modes use `networkidle`.
- **`MaxListenersExceededWarning` during test runs** — `process.on('exit')` and `process.on('SIGINT')` handlers were stacked on every `BrowserManager` instantiation. Fixed: handlers now registered once via a module-level flag.
- **Observe overlay right-click menu never appeared** — `injectStyles()` was called during `addInitScript` bootstrap when `document.head` is `null`; the silent throw prevented the `contextmenu` listener from registering. Fixed: `injectStyles()` moved to `showMenu()`, called only at user interaction when the DOM is always ready.
- **Overlay menu buttons (Comment Mode, Snapshot, End Session) did nothing** — capture-phase `dismissMenu` listener removed the menu from the DOM before button click handlers could fire. Fixed: now checks `closest('#talox-context-menu')` before dismissing.
- **Annotation modal Save/Cancel/End Session not responding to real mouse clicks** — backdrop (`position:fixed; inset:0; pointer-events:auto`) was intercepting all real mouse events before they reached the modal buttons. CDP `page.click()` bypassed this by using `getBoundingClientRect` directly, masking the bug. Fixed: added `pointer-events:none` to the backdrop; replaced backdrop click listener with a document-level `mousedown` handler that checks `closest('#talox-annotation-modal')`.
- **`SessionReporter` crash on undefined `interaction.type`** — `capitalise()` was called with `undefined` for some interaction entries. Fixed: null guard added (`if (!str) return ''`).
- **Ghost browser windows on macOS** — `launchPersistentContext` with `headless: true` showed ghost window frames on macOS. Fixed: `--headless=new` Chrome flag applied on macOS for headless non-observe runs.

### Changed

- **`agent-actions.spec.ts`** now launches in `debug` mode instead of default `smart` mode — correct for testing against a local fixture server you own.
- **E2E tests expanded** from 18 navigation-only assertions to 37 full-interaction tests including: form fill + submit → success div visible, value persistence after focus change, mouseMove traversal, fidget/think simulation, scrollTo viewport verification, evaluate() DOM manipulation, findElement() → click() end-to-end, multi-tab management, shadow DOM collection, setAttentionFrame/clearAttentionFrame scoping.

---

## [1.2.0] - 2026-03-18

### Added

- **`observe` mode** — human drives the browser, agent watches. Full session report generated automatically on browser close.
  - Right-click context menu with three actions: **Comment Mode**, **Snapshot**, **End Session**
  - **Comment Mode** activates a DevTools-style element inspector (crosshair cursor, blue highlight on hover)
  - Annotation modal with preset tag chips (🐛 Bug, 📝 Note, ❓ Question, ✨ Improve) + custom tag input (type & press Enter)
  - Resizable textarea with custom `↘` drag handle
  - Bottom button row: `Cancel` (ghost) + `💾 Save` (primary)
  - **Ctrl/Cmd+Z** undo — removes last submitted annotation from in-memory buffer
  - Browser close → session auto-finalized, report written, `sessionEnd` event fires
  - Session reports in **JSON** (machine-readable) and/or **Markdown** (paste-into-chat) via `output` option
  - `ObserveSession`, `AnnotationBuffer`, `SessionReporter`, `OverlayInjector` classes exported

- **`smart` mode** — replaces `adaptive`/`balanced`/`browse`/`qa` with a self-healing outcome-feedback loop
  - `AdaptationEngine` runs after every interaction, detects bot signals, applies named strategies
  - `BotDetector` identifies CAPTCHAs, hard blocks, HTTP 429, fingerprinting scripts
  - Named strategies: `stealth_nudge`, `stealth_escalation`, `semantic_fallback`, `pace_reduction`, `backoff`, `captcha_pause`
  - New `adapted` event emitted only in `smart` mode — semantically distinct from `bugDetected`

- **`adapted` event** — `{ reason, strategy, from, to }` — Talox changed its own settings in response to an outcome. Not a website bug.

- **`sessionEnd` event** — `{ sessionId, reportPath, durationMs, interactionCount, annotationCount }` — observe session completed.

- **`annotationAdded` / `annotationUndone` events** — observe mode only.

- **Typed `EventBus<TMap>`** — fully generic typed event emitter. All `on/off/emit` calls are TypeScript-enforced against `TaloxEventMap`.

- **`ModeManager`** — extracted from `TaloxController` into a dedicated class. Single source of truth for mode presets and settings.

- **`ActionExecutor`** — extracted interaction logic (click, type, navigate, etc.) into a focused single-responsibility class.

- **`SessionManager`** — extracted browser lifecycle, multi-page management, and auto-thinking into a focused class.

- **Observe mode output flag** — `launch('id', 'ops', 'observe', 'chromium', { output: 'json' | 'markdown' | 'both' })`. Default: `'both'`.

### Changed

- **`TaloxController`** refactored from a 2,223-line monolith into a thin ~200-line orchestrator that delegates to `EventBus`, `ModeManager`, `ActionExecutor`, and `SessionManager`.

- **`bugDetected` event** now emits **only in `debug` mode**. In all other modes, bugs are collected silently into `TaloxPageState.bugs`. This eliminates event noise in production agent pipelines.

- **`consoleError` event** now emits only in `debug` and `observe` modes.

- **Mode consolidation**: 6 modes → 4 canonical modes:
  | Old | New |
  |-----|-----|
  | `adaptive` | `smart` (deprecated alias) |
  | `stealth`  | `smart` (deprecated alias) |
  | `balanced` | `smart` (deprecated alias) |
  | `browse`   | `smart` (deprecated alias) |
  | `qa`       | `smart` (deprecated alias) |
  | `speed`    | `speed` (unchanged) |
  | `debug`    | `debug` (unchanged) |
  | _(new)_    | `observe` |

  Deprecated strings continue to work with a `console.warn` migration hint. Will be removed in v2.0.

### File Structure

```
src/
├── core/
│   ├── controller/         ← NEW: TaloxController split into 4 files
│   │   ├── TaloxController.ts
│   │   ├── ActionExecutor.ts
│   │   ├── ModeManager.ts
│   │   ├── SessionManager.ts
│   │   └── EventBus.ts
│   ├── observe/            ← NEW: observe mode module
│   │   ├── ObserveSession.ts
│   │   ├── OverlayInjector.ts
│   │   ├── AnnotationBuffer.ts
│   │   ├── SessionReporter.ts
│   │   └── overlay/
│   │       ├── bridge.ts
│   │       ├── contextMenu.ts
│   │       ├── elementInspector.ts
│   │       ├── annotationModal.ts
│   │       └── index.ts
│   └── smart/              ← NEW: smart mode module
│       ├── AdaptationEngine.ts
│       ├── BotDetector.ts
│       └── strategies.ts
├── types/
│   ├── index.ts            ← updated (re-exports all type modules)
│   ├── modes.ts            ← NEW
│   ├── events.ts           ← NEW
│   ├── annotation.ts       ← NEW
│   └── session.ts          ← NEW
```

---

## [1.1.0] - 2026-03-18

### Changed
- Replaced `playwright-extra` + `puppeteer-extra-plugin-stealth` with **Patchright** — a patched Playwright driver that fixes detection at the driver level rather than via JS injection
- Patchright eliminates the `Runtime.enable` CDP leak (the primary automation detection signal), removes the `--enable-automation` flag, and patches other command-flag detection vectors
- `puppeteer-extra-plugin-stealth` fingerprint is no longer visible to detection tools (was identified by CreepJS)
- Removed `--disable-blink-features=AutomationControlled` from manual args — Patchright handles this correctly
- Adaptive mode now uses Patchright for Chromium; Firefox/WebKit fall back to standard Playwright

### Fixed
- Headless VPS compatibility: all features (screenshots, visual diff, OCR, GhostVisualizer) confirmed working fully headless without a display server

---

## [1.0.0] - 2026-03-18

### Added

- `TaloxController` — main orchestration API with mode/preset manager
- `BrowserManager` — Playwright/Chromium lifecycle with persistent profiles
- `HumanMouse` — Biomechanical Ghost Engine (Fitts's Law, Bezier curves, quintic easing, variable typing cadence)
- `PageStateCollector` — AX-Tree + DOM state harvester returning agent-ready JSON
- `VisionGate` — visual verification via Pixelmatch, SSIM, and Tesseract.js OCR
- `RulesEngine` — layout bug detection via bounding box analysis
- `SemanticMapper` — maps AX-Tree to semantic entities for intent-based interaction
- `SelfHealingSelector` — auto-rebuilds selectors when DOM changes
- `NetworkMocker` — record/replay/mock network traffic
- `AXTreeDiffer` — structural diff between AX-Tree snapshots
- `GhostVisualizer` — mouse path overlay for session replay and debugging
- `PolicyEngine` — YAML-based action restrictions per profile
- `TaloxTools` — 14 LLM function-calling tools (OpenAI / Claude compatible)
- Six execution modes: `adaptive`, `debug`, `balanced`, `speed`, `browse`, `qa`
- Three profile classes: `ops`, `qa`, `sandbox`
- Structured `TaloxPageState` JSON contract for every action
- Behavioral DNA fingerprinting per profile
- Adaptive density awareness based on UI element density
- `src/schema/TaloxPageState.schema.json` — machine-readable JSON Schema
- `llms.txt` — flat file for LLM/agent consumption of the full API
- `.github/` — issue templates, PR template, CI workflow
- `CODE_OF_CONDUCT.md` — Contributor Covenant
