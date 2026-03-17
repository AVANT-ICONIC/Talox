# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-17

### Added
- `llms.txt` — single flat file for LLM/agent consumption of the full API and contract
- `src/schema/TaloxPageState.schema.json` — machine-readable JSON Schema for the agent contract
- `.github/` — issue templates (bug, feature), PR template, CI workflow (build + test on push/PR)
- `CODE_OF_CONDUCT.md` — Contributor Covenant

### Fixed
- `src/types/index.ts` — synced with `TALOX-CONTRACTS.md`: added `axTree`, `profileId`, `warnings/logs` in console, `role/text/isActionable` on interactive elements, full `BehavioralDNA`, `VisualDiffResult`, and `TaloxProfile.policy`
- `package.json` — corrected repository URL, bugs URL, homepage, and author field
- `CONTRIBUTING.md` — corrected repository clone URL
- `docs/TALOX-CONTRACTS.md` — rewritten to match actual types; added `perceptionDepth` token cost table, full API method signatures

### Changed
- `examples/` — removed 8 scratch/dev files; rewrote 3 clean examples with full comments



### Added
- `TaloxController` — main orchestration API with mode/preset manager
- `BrowserManager` — Playwright/Chromium lifecycle with persistent profiles
- `HumanMouse` — Biomechanical Ghost engine (Fitts's Law, Bezier curves, quintic easing, typo simulation)
- `PageStateCollector` — AX-Tree + DOM state harvester returning agent-ready JSON
- `VisionGate` — visual verification via Pixelmatch, SSIM, and Tesseract.js OCR
- `RulesEngine` — layout bug detection via bounding box analysis
- `SemanticMapper` — maps AX-Tree to semantic entities for intent-based interaction
- `SelfHealingSelector` — auto-rebuilds selectors when DOM changes
- `NetworkMocker` — record/replay/mock network traffic
- `AXTreeDiffer` — structural diff between AX-Tree snapshots
- `GhostVisualizer` — mouse path overlay for session replay and debugging
- `PolicyEngine` — YAML-based action restrictions per profile
- Six execution modes: `stealth`, `debug`, `balanced`, `speed`, `browse`, `qa`
- Three profile classes: `ops`, `qa`, `sandbox`
- Behavioral DNA fingerprinting per profile
- Adaptive stealth based on UI element density
- Automated thinking behaviors (idle micro-interactions)
