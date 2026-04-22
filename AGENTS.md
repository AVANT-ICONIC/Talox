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

### Current Status (2026-04-21) — v6.0.0

- **0 total issues** (all src, 0 test issues)
- Quality gate: **OK**
- **0 BLOCKER**
- **0 CRITICAL**
- **0 MAJOR** — code smells
- **0 MINOR** — code smells
- **1192 tests** across **69 files**

## Build & Test

```bash
npm run build          # Compile TypeScript
npm run test           # Run all unit tests (1192 tests across 69 files)
npm run test:e2e       # Run Playwright E2E tests
npm run test:real      # Run real-world integration tests
npm run typecheck      # TypeScript strict mode check
npm run lint           # Biome lint
```
