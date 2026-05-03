# Talox — Agent Guide

> Local-first, open-source, stateful browser runtime for AI agents.

## Quick Start

```bash
npm install
npm run build
npm run test          # unit tests
npm run typecheck     # TypeScript check
```

## Project Structure

```
src/
  cli/talox.ts                  # CLI entry (npx talox)
  core/
    BrowserManager.ts           # Browser lifecycle, contexts, pages
    PageStateCollector.ts       # DOM/AX/network state collection
    PerceptionStack.ts          # Layered observation (cheap/medium/heavy)
    VisionGate.ts               # Visual regression + OCR
    InteractionReliability.ts   # 9 failure-pattern recovery strategies
    ChallengeDetector.ts        # Cloudflare/captcha/login-wall detection
    ChallengeResolver.ts        # Local-only fallback flows
    SessionSnapshot.ts          # State capture/restore across browser restarts
    GhostVisualizer.ts          # Debug PNG overlay generator
    ArtifactBuilder.ts          # Session artifact assembly
    SemanticMapper.ts           # AX-tree → structured semantic output
    SelfHealingSelector.ts      # Selector adaptation with success tracking
    SiteWarmup.ts               # Generic per-domain interstitial bypass registry
    PolicyEngine.ts             # Allowlist/blocklist guard
    ProfileVault.ts             # Persistent browser profiles
    NetworkMocker.ts            # Request interception for testing
    HumanMouse.ts               # Biomechanical cursor movement
    RulesEngine.ts              # Per-domain interaction rules
    controller/
      TaloxController.ts        # Main public API surface
      ActionExecutor.ts         # Click/type/navigate/scroll execution
      SessionManager.ts         # Session lifecycle + cursor heartbeat
      TakeoverBridge.ts         # Human handoff/resume state machine
    loop/
      AutonomousLoop.ts         # Self-driving plan-execute-recover loop
      Planner.ts                # LLMPlanner + Planner interface with generateSkill()
      types.ts                  # Loop step, result, and config types
    skills/
      SkillLoader.ts            # Loads SKILL.md files by hostname
      SkillWriter.ts            # Generates new skills from LLM output
      index.ts                  # Skills barrel export
    smart/
      AdaptationEngine.ts       # Strategy selection with domain memory
      DomainMemory.ts           # EWMA per-hostname strategy scoring
    observe/
      ObserveSession.ts         # Forensic-grade observation mode
      SessionReporter.ts        # JSON/MD/HTML report generation
      OverlayInjector.ts        # Browser overlay for debug annotations
      AnnotationBuffer.ts       # In-memory annotation queue
  types/                        # Public type contracts (TaloxPageState, events, settings)
  tools/practical-tools.ts      # Utility actions (download, wait, extract)
  presets.ts                    # Built-in profiles (research, qa, gaming, browser-lab)
  index.ts                      # Public exports
tests/
  unit/                         # Pure unit tests
  core/                         # Integration tests for core modules
  real/                         # Real-world E2E tests (X.com, Reddit, etc.)
```

## Key Concepts

- **State Contract**: `TaloxPageState` is the frozen v1 public contract. Every action returns it.
- **Compact Variants**: `full`, `agent`, `debug` — use `getState('agent')` for LLM context.
- **Takeover**: Human handoff with typed reasons, timeout policies, and session restore.
- **Adaptation**: `DomainMemory` + `AdaptationEngine` learn which strategies work per domain.
- **Autonomous Loop**: `AutonomousLoop` runs a plan-execute-observe cycle driven by an LLM `Planner`. On blockers, the loop can ask the planner to generate a new skill via `SkillWriter`, which is auto-loaded by `SkillLoader` on future runs. Convergence detection recovers from stuck loops.
- **Self-Learning Skills**: `SkillWriter` produces SKILL.md files from blocker analysis. `SkillLoader` auto-discovers and loads them by hostname, so the agent improves over time.

## CLI Commands

```bash
talox run            # Start autonomous task execution loop
talox skill create   # Interactively create a new skill file
talox observe        # Start observation mode with overlay
talox chat           # Built-in LLM chat mode
talox doctor         # Run diagnostic checks
talox init           # Scaffold a new project
```

## Code Health (Avant Radar)

This repo is tracked by avant-radar for continuous code health monitoring.

```bash
# From the avant-radar repo:
radar up                          # Start SonarQube + backend
radar add talox /path/to/talox    # Register this repo
radar status                      # Check all registered repos
radar scan && radar wait          # Run full analysis
radar issues --severity CRITICAL  # List critical issues
radar tasks                       # Show current radar tasks
```

SonarQube dashboard (local): http://localhost:7372/dashboard?id=talox

### Current Status (2026-05-02) — v7.0.0

- **0 total issues** (all src, 0 test issues)
- Quality gate: **OK**
- **0 BLOCKER**
- **0 CRITICAL**
- **0 MAJOR** — code smells
- **0 MINOR** — code smells
- **79+ test files** | **1,645 tests** (unit: 1,457 + research: 136 + smoke: 61 + property: 53 + snapshot: 5 + perf: 11 + error-paths: 20 + browser integration: 105 + E2E: 13)

### Test Structure

| Suite | Config | Files | Tests | Requires Browser |
|-------|--------|-------|-------|-----------------|
| Unit | vitest.config.unit.ts | 61 | 1,255 | No |
| Smoke | vitest.config.smoke.ts | 1 | 61 | No |
| Property | vitest.config.unit.ts | 4 | 53 | No |
| Snapshot | vitest.config.unit.ts | 1 | 5 | No |
| Performance | vitest.config.unit.ts | 1 | 11 | No |
| Error-Paths | vitest.config.browser.ts | 1 | 20 | Yes |
| Browser Integration | vitest.config.browser.ts | 17 | 105 | Yes |
| E2E Local | vitest.config.e2e.ts | 1 | 13 | Yes |

## Stealth & Anti-Detection

Talox uses a multi-layered stealth stack combining driver-level patches (Patchright) and JS-level fingerprint spoofing.

### Architecture

```
Layer 1: Patchright Driver (driver-level)
  ├── Removes --enable-automation flag
  ├── Fixes CDP Runtime.enable leak
  └── Patches navigator.webdriver at protocol level

Layer 2: Chromium Launch Args (process-level)
  ├── --disable-blink-features=AutomationControlled
  ├── --disable-infobars
  ├── --no-first-run / --no-default-browser-check
  └── --window-size=1280,720

Layer 3: JS Injection via addInitScript (page-level, 19 patches)
  ├── Navigator.webdriver deletion (property must not exist)
  ├── Chrome runtime spoofing (full runtime/app/csi/loadTimes API)
  ├── PluginArray spoofing (real PluginArray prototype chain)
  ├── Language/platform/hardware spoofing (from fingerprint profile)
  ├── Canvas fingerprint noise (subtle pixel manipulation)
  ├── WebGL vendor/renderer spoofing (from fingerprint profile)
  ├── AudioContext spoofing (sampleRate/maxChannelCount/outputLatency)
  ├── Battery API spoofing
  ├── WebRTC leak prevention (ICE candidate filtering)
  ├── Font metrics fingerprint defense (letter-spacing offsets)
  ├── Timezone consistency (Intl.DateTimeFormat)
  ├── Permissions API override
  ├── Function.prototype.toString leak protection (native code facade)
  ├── iframe contentWindow detection prevention
  ├── Navigator.connection spoofing
  ├── Screen colorDepth/pixelDepth consistency
  └── CDP property cleanup (__playwright, __pw_manual, __PW_inspect)
```

### Detection Test Scores (2026-04-24)

| Test Suite | Score |
|------------|-------|
| Sannysoft Bot Detection | **31/31** (100%) |
| GitHub Login | ✅ Full page |
| Reddit (homepage + subreddits) | ✅ Passes (warmup auto-bypass) |
| nowsecure.nl (Cloudflare) | ✅ Passes |
| BrowserLeaks | ✅ Loads |
| CreepJS | ✅ Loads |

### Configuration

```ts
// Enable/disable Patchright (default: true)
new TaloxController(dir, {
  settings: { adaptiveStealthEnabled: true }
});

// Stealth level presets
new TaloxController(dir, {
  settings: { humanStealth: 0.8 }  // 0 = none, 1 = maximum human-like behavior
});
```

### Known Limitations

- **Patchright addInitScript**: Patchright's `addInitScript` silently fails (callback never executes). We use standard `playwright-core` instead — its `addInitScript` works correctly and our JS stealth stack runs before page scripts
- **Headless mode**: Chromium headless is inherently detectable; use headed mode for sensitive sites
- **Site warmup**: Sites like Reddit challenge new sessions with "Prove your humanity" (reCAPTCHA). Talox auto-bypasses via the `SiteWarmupRegistry` — navigating twice so the `edgebucket` cookie from the first request is sufficient. The registry also handles Cloudflare challenges, generic verification pages, and supports custom strategies via `register()`. Works for homepage and all subreddits

### Stealth Injection Architecture

```
Driver:    playwright-core           — standard driver, addInitScript works correctly
Browser:   channel: "chrome"         — uses system Chrome for real browser fingerprint
Inject:    page.addInitScript()      — runs BEFORE any page JS (19 patches)
Patches:   webdriver deletion (Navigator.prototype), chrome.runtime spoofing,
           ChromeDriver cleanup, plugin spoofing, canvas/WebGL/audio noise,
           CDP property cleanup, permissions override
Warmup:    SiteWarmupRegistry        — generic per-domain interstitial bypass
           ├── reddit.com    → detect "Prove/humanity" title, re-navigate with domcontentloaded
           ├── cloudflare    → detect "Checking/Just a moment" title or cf-browser-verification body,
           │                   wait 5s + re-navigate
           ├── generic       → detect "Attention Required/Access denied/Forbidden", wait 3s + re-navigate
           └── * (wildcard)  → falls back to cloudflare strategy
```

#### Adding Custom Warmup Strategies

```ts
import { SiteWarmupRegistry, type WarmupStrategy } from 'talox';

const registry = new SiteWarmupRegistry();

// Register a custom warmup for a specific domain
const myStrategy: WarmupStrategy = {
  name: 'acme-challenge',
  detect: async (page) => {
    const title = await page.title();
    return title.includes('Verify');
  },
  warmup: async (page, url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  },
};

registry.register('acme.com', myStrategy);
```

## Build & Test

```bash
npm run build          # Compile TypeScript
npm run test           # Run unit tests (watch mode)
npm run test:unit      # Run unit tests (watch mode)
npm run test:smoke     # Smoke test dist exports (no browser)
npm run test:property  # Property-based fuzz tests (no browser)
npm run test:snapshot  # State contract snapshots (no browser)
npm run test:perf      # Performance regression tests (no browser)
npm run test:browser   # Browser integration tests (needs Chromium)
npm run test:error-paths # Error-path resilience tests (needs Chromium)
npm run test:e2e:local # Local E2E with fixture server (needs Chromium)
npm run test:ci        # Full CI pipeline (no browser tests)
npm run typecheck      # TypeScript strict mode check
npm run lint           # Biome lint
```
