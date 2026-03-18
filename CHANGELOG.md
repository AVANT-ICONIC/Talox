# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- `docs/HARBOR-BOUNDARY.md` — defines Talox Core vs Harbor commercial split
- `.github/` — issue templates, PR template, CI workflow
- `CODE_OF_CONDUCT.md` — Contributor Covenant
