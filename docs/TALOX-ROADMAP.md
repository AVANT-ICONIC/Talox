# TALOX-ROADMAP.md

## v0: Foundation ✅ COMPLETE
- [x] Core Profile Vault & Runtime
- [x] Local-First Perception (AX-Tree, Bounding Boxes)
- [x] Rules Engine (Overlap, Clipped, Console, Network)
- [x] Vision Gate (Pixelmatch, SSIM, OCR)
- [x] Biomechanical Ghost Engine
- [x] Adaptive & Debug mode presets
- [x] Trace & Bug Reporting
- [x] SemanticMapper
- [x] SelfHealingSelector
- [x] NetworkMocker
- [x] AXTreeDiffer
- [x] GhostVisualizer
- [x] PolicyEngine (YAML)
- [x] Behavioral DNA Fingerprinting
- [x] Automated Thinking Behaviors

## v0.1: Agent DX ✅ COMPLETE
- [x] LLM Function Schema (TaloxTools)
- [x] Semantic Page Description (describePage)
- [x] Intent State (getIntentState)
- [x] Event Emitter (TaloxEventMap)
- [x] Utility Methods (screenshot, scrollTo, extractTable, waitForLoadState)
- [x] Direct Playwright Access (getPlaywrightPage)

## v0.2: Quality & Stability ✅ COMPLETE (v7.0.2–v7.4.0)
- [x] Logger abstraction (12 core modules)
- [x] Type safety sprint (~70 suppressions killed)
- [x] Zero `@ts-expect-error` in codebase
- [x] 11 `as any` remaining as documented exceptions
- [x] Test hardening (93 files, 1694 tests)
- [x] CI green (3/3 gates)
- [x] Chromium dep → optional
- [x] Limitation docs (Patchright, headless, site warmup)

## v1: Enhanced Intelligence 🧠
- [ ] **Local VLM Integration:** Optional quantized local vision models behind the existing `VisualReasoner` interface.
- [x] **External Solver Hooks:** Extensible visual/captcha solver hooks through the VLM and solver interfaces.
- [x] **Interaction Quality Score:** Session-level mouse, typing, scroll, and click quality scoring.
- [x] **Multi-agent orchestration:** `AgentCoordinator` plus the Plan-Delegate-Observe loop for parallel browser agents.

## v2: Deployment ☁️ ✅ COMPLETE
- [x] **Docker Image:** Non-root Playwright Chromium image with sandbox validation and CI smoke coverage.
- [x] **MCP Server:** Native dependency-free stdio MCP server for direct agent integration.
- [x] **Headless-first mode:** Autonomous runs default to headless while interactive modes remain headed.

## v3: Ecosystem 🔌
- [x] **Plugin Architecture:** Community-driven rules and vision detectors with runtime isolation and validation.
- [ ] **Platform Adapters:** Pre-built adapters for common sites and CMSes.
- [x] **Replay UI:** Offline interactive session replay for debugging agent decisions.
- [x] **Cross-origin iframe trust:** Existing `trustedDomains` now drives default-deny frame trust and trust-gated CDP execution.

### Current next target

**Platform Adapters** is the only remaining v3 ecosystem milestone. The design should build on Talox's existing skills, semantic state, plugins, and controller APIs rather than introduce a second automation abstraction.
