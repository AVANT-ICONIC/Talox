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
- [ ] **Local VLM Integration:** Quantized vision models (Moondream, Phi-3 Vision) for high-level visual reasoning.
- [ ] **External Solver Hooks:** Plugin interface for external challenge-solving services.
- [ ] **Interaction Quality Score:** Real-time scoring of interaction fidelity per session.
- [ ] **Multi-agent orchestration:** Coordinate multiple Talox sessions for parallel tasks.

## v2: Deployment ☁️
- [ ] **Docker Image:** Optimized container for cloud/Kubernetes deployment.
- [ ] **MCP Server:** Native Model Context Protocol server for direct agent integration.
- [ ] **Headless-first mode:** Proper headless support with improved stealth.

## v3: Ecosystem 🔌
- [ ] **Plugin Architecture:** Community-driven rules and vision detectors.
- [ ] **Platform Adapters:** Pre-built adapters for common sites and CMSes.
- [ ] **Replay UI:** Interactive session replay for debugging agent decisions.
