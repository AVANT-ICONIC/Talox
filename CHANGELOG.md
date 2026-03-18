# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
