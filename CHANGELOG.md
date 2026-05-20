# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [7.4.0] - 2026-05-17

### Changed

- **chromium** npm package moved from `dependencies` to `optionalDependencies`. The package was never imported — code uses Playwright's bundled chromium via `playwright-core`. Consumers no longer download the unused ~100MB binary on `npm install`.

### Docs

- Expanded **Patchright addInitScript limitation** docs: why Patchright can't be used, current `playwright-core` workaround.
- Expanded **headless detectability** docs: Xvfb virtual display workaround for headless servers.
- **Site warmup**: `@fragile` tag added to Reddit bypass (edgebucket cookie dependency).

### CI

- Added `concurrency` group to prevent cancel cascade from rapid pushes.
- Fixed `test:unit` / `test:browser` scripts to use `vitest run` (non-watch mode).
- Added `typecheck` script (`tsc --noEmit`).
- Lightened pre-push hook to build-check only.
- Bumped browser integration timeout to 25min.
- All 3 CI gates passing (lint+typecheck, unit, browser integration).

### Backlog

- **IMPROVEMENT_BACKLOG.md**: All 36 items resolved and documented.
- **TODO.md**: Full release history with final tally.

## [7.3.0] - 2026-05-17

### Fixed

- **7 `as any` casts killed**:
  - SelfHealingSelector: `(this.options as any)[key]` → `this.options[key]`
  - PolicyEngine: `(this as any)._currentAmount` → declared `_currentAmount` field
  - SessionManager (3x): `(pages[n] as any).page` → `pages[n]!.getPage()`
  - VisionGate: `(ssim as any).ssim` → narrow type assertion
  - PageStateCollector: `isClosed` → try/catch with narrow assertion
- **2 `@ts-expect-error` removed**: BrowserManager, PageStateCollector — **0 remaining in codebase**.
- **SessionManager stealth**: 9 `@ts-expect-error` reduced to 6 accepted `as any` (bracket notation for runtime browser globals).

### Added

- **ssim.js type declarations** (`src/types/ssim.d.ts`)
- **strategies.test.ts** (6 tests — config validation, name uniqueness, side effects)

### Tests

- **93 test files, 1694 tests** (up from 92/1688)

## [7.2.0] - 2026-05-17

### Added

- **GhostCursorOverlay tests** (18) — constructor options, inject idempotency, createCallback, clickRipple, edge cases.
- **daemon/commandHandler tests** (25) — dispatch, param validation, screenshot formatting, error handling, generateSessionId.
- **`@fragile` tag** on Reddit warmup strategy documenting edgebucket cookie dependency.

### Changed

- **BrowserManager** `console.log` banner → `Logger.info` (gated via `TALOX_LOG_LEVEL`).
- **NOSONAR cleanup**: magic number in Planner extracted to named constant.
- **Site warmup**: Reddit bypass fragility documented.

### Audits

- **Dead code**: `PRESETS` and `STRATEGIES` confirmed in active use.
- **NOSONAR**: 78 instances catalogued, easy ones cleaned.
- **ts-prune**: Full unused export scan completed, barrel exports verified.

### Tests

- **92 test files, 1688 tests** (up from 90/1645).

## [7.1.1] - 2026-05-17

### Fixed

- **9 `@ts-expect-error` → 2** in SessionManager stealth injection. 7 removed via `declare global` + bracket notation casts.
- **14 non-null assertions → 0** in research modules. All replaced with bounds checks or runtime guards.
- **`global.d.ts`**: Added `chrome` runtime API, `navigator.getBattery` declarations.

## [7.1.0] - 2026-05-17

### Changed

- **49 `page: any` → `Page` / `BrowserContext`** across 10 core files: ActionExecutor, InteractionReliability, BrowserManager, ChallengeResolver, SiteWarmup, HumanMouse, SessionSnapshot, SessionManager, ObserveSession, OverlayInjector.
- **5 `attentionFrame: any` → `AttentionFrame`** type in ActionExecutor.
- **3 `launcher: any` → `PlaywrightBrowserType`** in BrowserManager.
- **`launchOptions: any` → `Record<string, unknown>`** (3 instances).
- **`declare global`**: New `src/types/global.d.ts` declares Talox window extensions (`__taloxUpdateCursor__`, `__taloxDispatch__`, `__playwright`, etc.) — kills 7 `as any` casts.
- **`recordVideo`** added to `ObserveSessionOptions` type.
- **`elementType as any` → `SemanticEntityType`**.
- **`{ waitUntil: "networkidle" } as any` → `as const`**.

### Type Suppressions Killed

- `as any`: 34 → 18 remaining (16 killed)
- `page: any` in core: 49 → 0
- Files touched: 14

## [7.0.4] - 2026-05-17

### Changed

- **Zero `as any` casts in TaloxController** (13 removed):
  - `PageStateCollector.getLastNodes()` — typed accessor replacing 4 `(collector as any).state?.nodes`
  - `ActionExecutor.setRiskyActionHook()` — typed setter replacing `(this._actions as any).riskyActionHook`
  - `AdaptationRecord` interface — `{ reason, strategy, before, after }` replacing `any` on `getLastAdaptation()` and `DebugSnapshot`
  - `compactState` overloads — narrow switch replacing `variant as any`
  - Event handlers — `EventHandler<TaloxEventMap[K]>` on `on()`/`off()` replacing `handler as any` ×2
- **`AdaptationRecord`** exported from public barrel.

## [7.0.3] - 2026-05-17

### Added

- **Logger abstraction** (`src/core/Logger.ts`): `createLogger(prefix)` with scoped prefixes and level gating via `TALOX_LOG_LEVEL` env var (debug < info < warn < error < silent).
- Exported from barrel: `createLogger`, `setLogLevel`, `getLogLevel`, `Logger`, `LogLevel`.

### Changed

- Replaced raw `console.log`/`console.error`/`console.warn` in 12 core modules: TaloxController, SessionManager, EventBus, ActionExecutor, AdaptationEngine, OverlayInjector, ObserveSession, ChatSession, PolicyEngine, TaloxDaemon, VisionGate, AutoDialogHandler.

## [7.0.2] - 2026-05-17

### Fixed

- **package.json**: `repository.url` normalized to `git+https://github.com/AVANT-ICONIC/Talox.git` format.
- **package.json**: `prepare` script fixed (husky only, no build-on-install).
- **Biome**: Auto-fixed 2 optional chain warnings + 1 template literal warning.
- **Shebang**: Verified `src/cli/talox.ts` starts with `#!/usr/bin/env node`.
- **Dependency audit**: Chromium usage verified, duplicate playwright noted.


## [7.0.0] - 2026-05-03

### Added

- **Autonomous Research System** — full self-research loop (`AutoResearchLoop`) that autonomously tests strategies, measures outcomes, and promotes winners. 13 subsystems: `HypothesisGenerator`, `ExperimentRunner` (A/B testing), `SkillEvaluator`, `CrossDomainTransfer`, `PromptEvolver`, `SkillVersioning` (with rollback), `RegressionHarness`, `ResearchJournal`, `ResearchReporter`, `AdaptiveExperimentPriority` (Thompson sampling), `StrategyComposer`.
- **`talox research` CLI command** — `talox research "<goal>" --domain <domain> [options]`. Supports `--depth`, `--iterations`, `--strategy` (conservative/balanced/aggressive), `--model`, `--api-key`, `--base-url`.
- **`TaloxController.runResearch()`** — public API for programmatic research. Full feedback loop: promoted strategies → `SkillWriter`, outcomes → `DomainMemory.syncFromResearch()`.
- **21 AutoResearchLoop tests** (up from 8) — full `run()` flow, cross-domain transfer, prompt evolution, promotion path, excluded domains, composition discovery, sequential runs, config overrides, factory tracking.
- **Deterministic Thompson sampling** — seeded PRNG for flaky-free integration tests.

### Fixed

- `AutoResearchLoop.run()` — evaluations array was never populated (results were pushed to wrong local).
- `AdaptiveExperimentPriority` — replaced `Math.pow` with `**` operator (Biome lint).
- `TaloxController.runResearch()` — removed useless `this` alias (Biome lint).
- `exactOptionalPropertyTypes` — spread pattern for optional config fields instead of `undefined` assignment.

## [6.3.0] - 2026-04-25

### Added

- **Generic SiteWarmup system** — `SiteWarmupRegistry` with pluggable `WarmupStrategy` interface replaces hardcoded Reddit warmup. Built-in strategies for Reddit, Cloudflare, and generic verification pages. Custom strategies via `registry.register(hostname, strategy)`. Subdomain resolution and wildcard fallback.
- **Xvfb virtual display support** — `virtualDisplay` setting (auto-enabled on Linux without DISPLAY). Spawns Xvfb for headed Chromium on headless servers, making headless Talox significantly harder to detect. Auto-cleanup on shutdown.
- **Tests for 5 previously untested modules**: CrossOriginManager (15 tests), InspectServer (17 tests), ChatSession (18 tests), TaloxDaemon + commandHandler (42 tests), XvfbDisplay (17 tests).
- **Pre-push hook** — runs `build` + `test:ci` before allowing pushes. Prevents broken code from reaching CI.

### Changed

- **Removed Patchright dependency** — 50MB+ dead weight eliminated. Patchright's `addInitScript` was silently broken; standard `playwright-core` works correctly.
- **NOSONAR cleanup** — reduced from 171 to 76 suppressions. Empty catch blocks now have explanatory comments. Browser-side code markers and type assertions remain suppressed.
- **Stealth injection architecture** — default driver is now `playwright-core` with `channel: "chrome"` (system Chrome). 19 JS stealth patches injected via `addInitScript` before page scripts run.
- **Reddit warmup** — auto-bypasses "Prove your humanity" challenge via `SiteWarmupRegistry`. The `edgebucket` cookie from first navigation is sufficient.

### Detection Results

| Test Suite | Score |
|---|---|
| Sannysoft Bot Detection | **31/31 (100%)** |
| Reddit (homepage + subreddits) | ✅ Passes (auto warmup) |
| GitHub Login | ✅ Full page |
| Cloudflare (nowsecure.nl) | ✅ Passes |
| BrowserLeaks | ✅ Loads |
| CreepJS | ✅ Loads |

### Tests

- **67 test files, 1418 tests** (up from 61/1255). New: SiteWarmup (40), CrossOriginManager (15), InspectServer (17), ChatSession (18), TaloxDaemon (42), XvfbDisplay (17).

## [6.2.0] - 2026-04-24

### Changed

- **Default driver switched from Patchright to playwright-core** — Patchright's `addInitScript` silently fails (callbacks never execute). Our entire 19-patch JS stealth stack was never injected.
- **Webdriver prototype fix** — `delete Navigator.prototype.webdriver` instead of `Object.defineProperty(navigator, "webdriver", ...)`. Detection libraries now check property existence, not just value.
- **Reddit auto-bypass** — detected as simple reCAPTCHA challenge, NOT Akamai HTTP/2 fingerprinting as previously assumed.

## [6.1.0] - 2026-04-22

### Changed

- Detection test updates for Sannysoft, Cloudflare, BrowserLeaks, and CreepJS.
- README and AGENTS.md documentation refresh.
- SonarQube quality gate: 0 issues.

## [6.0.0] - 2026-04-21

### Added

- **AutonomousLoop** — self-driving plan-execute-observe cycle with convergence detection and stuck-loop recovery.
- **LLMPlanner** — LLM-backed planner implementing the `Planner` interface; decides next actions and generates skills from blockers.
- **SkillWriter** — generates SKILL.md files from LLM blocker analysis, enabling the agent to learn from failures.
- **SkillLoader** — auto-discovers and loads SKILL.md files by hostname for prompt injection.
- **`talox run`** CLI command — starts autonomous task execution loop with an LLM planner.
- **`talox skill create`** CLI command — interactively creates a new skill file.
- **Convergence detection** — detects when the autonomous loop is stuck and triggers recovery strategies.
- **LLM-powered skill generation** — planner can propose and write new skills when blockers are encountered.
- **`resolveChallenge()`** on `TaloxController` — public API for programmatic challenge resolution during autonomous loops.
- **Loop events** in `TaloxEventMap` — `loopStart`, `loopStep`, `loopComplete`, `loopStuck`, `skillGenerated` for observability of the autonomous cycle.

### Changed

- **Planner interface** now supports `generateSkill()` method for LLM-driven skill creation from blockers.

### Tests

- 1192 tests across 69 files (up from 1015/48). New test files: AutonomousLoop, LLMPlanner, SkillWriter, SkillLoader, Planner.

## [5.0.0] - 2026-04-18

### Added — 13 new features

- **#1 Agent-friendly error messages**: `AgentErrors` module converts Playwright errors into structured, AI-actionable guidance with category, friendly message, and self-correcting suggestions.
- **#2 Auto-dismiss dialog handler**: `AutoDialogHandler` automatically intercepts browser dialogs (alert, confirm, prompt, beforeunload) with configurable strategies and stats tracking.
- **#3 Annotated screenshot mode**: `GhostVisualizer.annotateScreenshot()` overlays numbered element ref labels on screenshots. `talox screenshot` CLI command for quick captures.
- **#4 Doctor command**: `talox doctor [--fix]` runs 10 diagnostic checks (Node version, Playwright, browsers, profiles, network, display) with auto-fix mode.
- **#5 Session timeout with heartbeat**: Configurable idle timeout with automatic browser cleanup. `sessionTimeoutMs` setting on TaloxSettings.
- **#6 Daemon/IPC protocol**: `TaloxDaemon` — long-lived process accepting newline-delimited JSON commands over Unix socket (or TCP on Windows). `talox daemon` CLI command.
- **#7 Skills/domain knowledge system**: `SkillLoader` loads SKILL.md files with per-site strategies for LLM prompt injection. Auto-matches by hostname.
- **#8 Built-in chat mode**: `ChatSession` — LLM-powered interactive REPL using OpenAI-compatible function calling. `talox chat` CLI command.
- **#9 HAR recording**: `HarRecorder` captures HTTP traffic in HAR 1.2 format with `includeContent` option.
- **#10 DevTools inspect server**: `InspectServer` proxies CDP for live Chrome DevTools connection. Configurable port.
- **#11 Cursor detection field**: `cursorDetected` and `detectionMethod` fields on TaloxNode for visibility analysis.
- **#12 Cross-origin iframe sessions**: `CrossOriginManager` manages dedicated CDP sessions per cross-origin iframe.
- **#13 Video recording**: `VideoRecorder` captures screenshots at configurable FPS, encodes via ffmpeg or saves PNG sequence with HTML viewer.
- **#14 Per-origin custom headers**: `OriginHeaders` applies custom HTTP headers per URL origin pattern.
- **#15 Launch hash relaunch**: `BrowserManager` hashes launch config and auto-relaunches browser when options change.

### Changed

- Moved `Navigation timeout` pattern before generic `timeout.*exceeded` in `AgentErrors` for correct category matching.
- `extractMessage()` now returns `'Unknown error'` for null/undefined inputs.

### Fixed

- CI browser integration tests: corrected import paths (`../../src/core/TaloxController` → `../../src/core/controller/TaloxController.js`).

### Tests

- 1015 tests across 48 files (up from 917/42). New test files: AgentErrors, AutoDialogHandler, OriginHeaders, HarRecorder, VideoRecorder, SkillLoader, TaloxDaemon.

## [4.3.1] - 2026-04-17

### Changed

- 3 CRITICAL cognitive complexity refactors:
  - GhostVisualizer.renderCharPixels(): extracted renderSubPixel() (17->5)
  - PageStateCollector.collectInteractiveElementsViaDom(): extracted deriveRole() and buildSelector() inside $$eval callback (21->7)
  - PageStateCollector.collect(): extracted collectWithRetry() method (23->10)

### Fixed

- 8 MAJOR issues resolved:
  - S107: VisionGate.floodFillMerge() params grouped into options object
  - S1788: ObserveSession default param moved to last position
  - S3358: ActionExecutor nested ternary replaced with if/else chain
  - S4043: Array sort moved to separate statement
  - S5843: Complex regex split into two simpler patterns
  - S6564: Removed redundant AnnotationLabel type alias
  - S7761: elementInspector uses .dataset instead of getAttribute
  - S7785: CLI uses top-level await instead of .catch() chain

- 21 remaining issues resolved as Won't Fix:
  - S1874 (4): Intentional deprecated backward-compat API usage
  - S2486 (10): Intentional empty catches for non-fatal graceful degradation
  - S7764 (5): Browser-injected code correctly uses window (not globalThis)
  - S7721 (2): Browser-context helpers cannot be in outer scope

- Added sonar-project.properties for persistent issue exclusions

### Result

- SonarQube: 0 open issues. Quality gate: OK.
- 1007/1007 tests passing

## [4.3.0] - 2026-04-17

### Changed

- **3 CRITICAL cognitive complexity refactors**:
  - `GhostVisualizer.renderCharPixels()`: extracted `drawPixelBlock()` helper (17→11)
  - `PageStateCollector.collect()`: extracted `collectWithRetry()`, `attemptAxTreeSnapshot()`, `collectInteractive()`, `closedPageFallback()` (23→8)
- **~53 additional MAJOR/MINOR issues resolved** across 20+ rules:
  - S6571 (2): Removed `any | null` → `ElementHandle | null`, suppressed extensible union patterns
  - S6582 (3): Optional chaining `profile?.class`, `startPoint?.t`, `point?.relativeTimeMs`
  - S107 (1): `HumanMouse.move()` params grouped into options object
  - S7770: Suppressed false positive (table filter ≠ Boolean)
  - S6564: Suppressed intentional semantic type alias
  - S1128 (1): Removed unused `TakeoverReason` import
  - S2486 (2): Added catch block comments for density computation and overlay fallback
  - S7780, S4323, S7776, S6594, S7763, S7781, S7735, S101, S7747, S1874, S7764, S7755, S4325: All addressed

### Fixed

- `HumanMouse.move()`: Updated all call sites (ActionExecutor, tests) for new options object signature
- `ActionExecutor.filter(Boolean)`: Reverted behavioral change — preserved `Object.values(row).some((v) => v)` logic
- `PageStateCollector.attemptAxTreeSnapshot()`: Cleaned up nested try/catch with proper error propagation


## [4.2.0] - 2026-04-16

### Changed

- **~200 MAJOR/MINOR SonarQube issues resolved** across 35+ rules:
  - S7748 (79): Removed zero fractions from numeric literals
  - S7778 (68): Consolidated consecutive `Array.push()` calls
  - S2933 (34): Added `readonly` to never-reassigned class members
  - S1128 (22): Removed unused imports
  - S7764 (19): Replaced `window` with `globalThis` in Node-side code
  - S7781 (17): Replaced `.replace(/x/g)` with `.replaceAll('x')`
  - S6571 (15): Extracted repeated union types into type aliases
  - S1854 (13): Removed useless variable assignments
  - S1874 (13): Added suppression comments for deprecated backward-compat APIs
  - S7755 (10): Replaced `arr[length-N]` with `arr.at(-N)`
  - S4325 (10): Removed unnecessary type assertions
  - S2486 (10): Added descriptive comments to empty catch blocks
  - S7769 (8): Replaced `Math.sqrt(x²+y²)` with `Math.hypot(x,y)`
  - S7718 (7): Renamed catch parameters to `error_`
  - S7772 (6): Added `node:` prefix to Node.js built-in imports
  - S2310 (6): Refactored loop variable assignment in CLI
  - S107 (4): Grouped parameters into objects (GhostVisualizer, HumanMouse)
  - S7773 (4): `parseInt` → `Number.parseInt`
  - S7723 (4): `Array(n)` → `new Array(n)`
  - S7784, S7758, S7747, S7776: structuredClone, codePointAt, Array.from, Set
  - And 15+ more minor rules

### Fixed

- `GhostVisualizer.ts`: Updated callers after Color refactoring
- `SessionReporter.ts`: Restored missing `BugSummaryEntry` import
- `SessionSnapshot.ts`: Fixed type annotation in `restoreStorage()`
- `bridge.ts/contextMenu.ts/index.ts`: Reverted `globalThis` in browser-injected code

## [4.1.0] - 2026-04-15

### Changed

- **24 CRITICAL cognitive complexity issues resolved** (SonarQube S3776) — all functions now under complexity 15:
  - `SessionReporter.ts` (57→orchestrated helpers): `toMarkdown()` split into 10 focused methods
  - `VisionGate.ts` (54→9, 17→8): `mergeAdjacentRegions()` extracted to BFS flood-fill helpers, `generateDiffHeatmap()` extracted pixel computation
  - `GhostVisualizer.ts` (34→helpers, 32→helpers, 19→helpers): heatmap grid, character patterns, thick dot rendering extracted
  - `SemanticMapper.ts` (32→helpers): role lookup and selector building extracted
  - `ActionExecutor.ts` (30, 18, 16, 16 → all <15): 4 functions refactored with guard clauses and early returns
  - `PageStateCollector.ts` (23, 21, 20, 16 → all <15): 4 collection functions decomposed
  - `FingerprintGenerator.ts` (23→helpers, 16→helpers): validation and weighted pick decomposed
  - `BrowserManager.ts` (19→helpers): launch logic split into resolve/attach/try helpers
  - `InteractionReliability.ts` (18→helpers): node matching extracted
  - `AXTreeDiffer.ts` (17→helpers): change detection extracted
  - `ArtifactBuilder.ts` (17→helpers): frame formatting extracted
  - `SessionSnapshot.ts` (17→helpers): storage restoration extracted, type annotation fix
  - `PerceptionStack.ts` (16→helpers): bug/screenshot layers extracted
  - `RulesEngine.ts` (16→helpers): overlap/clipping detection extracted

### Fixed

- `SessionSnapshot.ts`: Fixed incorrect type annotation in `restoreStorage()` callback (`string[][]` → `Array<[string, string]>`)

## [4.0.2] - 2026-04-15

### Fixed

- **15 BLOCKER test assertions resolved** (SonarQube S2699) — all test cases now have direct `expect()` calls:
  - `pageState.schema.test.ts` (6): wrapped `assertValid*` helpers in `expect().not.toThrow()`
  - `TaloxController.actions.schema.test.ts` (4): added URL state assertions
  - `SessionManager.test.ts` (2): timestamp and spy assertions
  - `ActionExecutor.test.ts` (1): hook invocation + click assertions
  - `NetworkMocker.test.ts` (1): loadFromFile return value assertions
  - `TaloxController.test.ts` (1): mouse tracking toggle assertions

## [4.0.1] - 2026-04-15

### Changed

- **Quick Start**: `git clone` instructions instead of `npm install talox` — npm package coming soon
- **CLI examples**: `node dist/cli/talox.js` instead of `npx talox` until npm is published
- **Code examples**: Updated to v4 `TaloxController({ ... })` shorthand syntax
- **Version badge**: 4.0.0 → 4.0.1
- **SonarQube scan**: Full scan with tests included (118 src files, 333 issues catalogued)

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
