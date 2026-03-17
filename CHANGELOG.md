# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
