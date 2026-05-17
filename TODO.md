# Talox Release Roadmap

> Generated 2026-05-17 from IMPROVEMENT_BACKLOG.md

## ✅ Done

|Version|What|Date|
|---|---|---|
|v7.0.2|package.json normalization, biome lint, dep audit|2026-05-17|
|v7.0.3|Logger abstraction — replace console.log in 12 core modules|2026-05-17|
|v7.0.4|Typed accessors — zero `as any` casts in TaloxController|2026-05-17|

---

## 🔜 v7.1.0 — Type Safety Sprint (~70 type suppressions killed)

### `page: any` → Playwright types (~50 instances)
- [ ] ActionExecutor — 16 `page: any`
- [ ] InteractionReliability — 8 `page: any`
- [ ] BrowserManager — 7 `launcher: any`, `launchOptions: any`
- [ ] ChallengeResolver — 6 `page: any`
- [ ] SiteWarmup — 5 `page: any`
- [ ] HumanMouse — 3 `page: any`
- [ ] SessionSnapshot — 4 `page: any`, `context: any`
- [ ] PageStateCollector — 12 `el: any` DOM handles
- [ ] ArtifactBuilder — 3 `payload: any`

### Remaining `as any` casts
- [ ] SessionManager — pages array, recordVideo, headed (5x)
- [ ] PolicyEngine — `_currentAmount` closure (2x)
- [ ] InspectServer — CDP session type (1x)
- [ ] CrossOriginManager — CDP command type (1x)
- [ ] VisionGate — ssim.js ESM compat (1x)
- [ ] SelfHealingSelector — dynamic options key (1x)
- [ ] OverlayInjector — event bus gap (1x)
- [ ] TakeoverBridge — global window extension (1x)
- [ ] GhostCursorOverlay — global window extension (2x)
- [ ] AutonomousLoop — controller internals (1x)

### Suppressions & assertions
- [ ] 9 `@ts-expect-error` → `declare global` augmentation (SessionManager stealth)
- [ ] Non-null assertions → bounds checks (research modules: ExperimentRunner, StrategyComposer, SkillVersioning, HypothesisGenerator)
- [ ] FingerprintGenerator generic return types
- [ ] Type index signatures cleanup

---

## 🔜 v7.2.0 — Test Hardening

- [ ] GhostCursorOverlay tests (zero coverage)
- [ ] daemon/commandHandler tests (zero coverage)
- [ ] Strategies definition tests
- [ ] Dead code audit (presets.ts, strategies.ts)
- [ ] NOSONAR suppressions audit (42 instances)

---

## 🔜 v7.3.0 — Robustness & Polish

- [ ] Site warmup fragility hardening (Reddit bypass)
- [ ] BrowserManager console.log banner → verbose gate
- [ ] CLI console.log → chalk/ora (doctor.ts, talox.ts)
- [ ] Legacy compat deprecation path
- [ ] Chromium dep → optional/peer
- [ ] Limitation docs (Patchright addInitScript, headless detectability)
- [ ] ts-prune full dead-code pass

---

*28 items remaining across 3 releases.*

## Progress — v7.1.0 (in progress)

### Done
- [x] `page: any` → `Page`/`BrowserContext` — 49 instances across 10 files
- [x] `attentionFrame: any` → `AttentionFrame` type — 5 instances
- [x] `launcher: any` → `PlaywrightBrowserType` — 3 instances
- [x] `launchOptions: any` → `Record<string, unknown>` — 3 instances
- [x] Global window extensions → `declare global` in `src/types/global.d.ts` — 7 `as any` killed
- [x] `resolvedOpts.recordVideo` → typed via `ObserveSessionOptions.recordVideo`
- [x] `this.settings.headed` → typed
- [x] `elementType as any` → `SemanticEntityType`
- [x] `{ waitUntil: "networkidle" } as any` → `as const`
- [x] `recordVideo` added to `ObserveSessionOptions` type

### Remaining (13 hard `as any`, 9 `@ts-expect-error`, non-null assertions)
- [ ] PolicyEngine `_currentAmount` closure (2x) — needs refactor
- [ ] SessionManager pages array internal access (3x) — needs wrapper type
- [ ] SelfHealingSelector dynamic key (1x)
- [ ] PageStateCollector `isClosed` (1x) — upstream Playwright gap
- [ ] InspectServer/CrossOriginManager CDP types (2x) — protocol looseness
- [ ] VisionGate ssim.js ESM (2x) — broken upstream types
- [ ] SessionSnapshot entries tuple (1x)
- [ ] OverlayInjector event payload (1x)
- [ ] 9 `@ts-expect-error` → `declare global` (SessionManager stealth)
- [ ] Non-null assertions → bounds checks (research modules)
- [ ] FingerprintGenerator generic returns
