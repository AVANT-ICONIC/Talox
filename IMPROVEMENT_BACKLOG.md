# Talox Improvement Backlog

> **Status: 28/36 resolved across v7.0.2–v7.2.0. Remaining 8 items → v7.3.0+v7.4.0.**
Generated: 2026-05-16

---

## 1. Lint / Biome Warnings ✅ (v7.0.2)

| Severity | File | Line | Description |
|----------|------|------|-------------|
| LOW | `src/core/controller/SessionManager.ts` | 714 | `lint/complexity/useOptionalChain` — `!globalThis.chrome \|\| !globalThis.chrome.runtime` should be `!globalThis.chrome?.runtime` |
| LOW | `src/core/controller/SessionManager.ts` | 941 | `lint/complexity/useOptionalChain` — `navigator.permissions && navigator.permissions.query` should be `navigator.permissions?.query` |
| LOW | `src/core/research/ResearchJournal.ts` | 182 | `lint/style/useTemplate` — string concatenation should use template literal |

> **Note:** Only 2 warnings + 1 info across 86 files. The codebase is very clean by lint standards. Auto-fixable with `npx biome check --fix src/`.

---

## 2. `as any` Casts 🔄 (v7.0.4+v7.1.0 — 21/34 resolved, 13 remaining)

| Severity | File | Line | What it works around |
|----------|------|------|----------------------|
| HIGH | `src/core/controller/TaloxController.ts` | 1115, 1126, 1135, 1141 | `(this._session.getActiveStateCollector() as any).state?.nodes` — accessing internal state through private API. Should expose a typed getter on SessionManager. |
| HIGH | `src/core/controller/TaloxController.ts` | 631 | `(this._adapt as any).getLastAdaptation?.()` — accessing AdaptationEngine internals. Should add `getLastAdaptation()` to public interface. |
| HIGH | `src/core/controller/TaloxController.ts` | 1274 | `(this._actions as any).riskyActionHook` — reaching into ActionExecutor private. |
| HIGH | `src/core/controller/SessionManager.ts` | 303, 344, 355 | `(this.pages[index] as any).page` — internal page wrapper leaking. Should type the pages array properly. |
| HIGH | `src/core/controller/SessionManager.ts` | 123, 124 | `(resolvedOpts as any).recordVideo` — untyped launch options. |
| MEDIUM | `src/core/controller/SessionManager.ts` | 215 | `(this.settings as any).headed` — accessing settings without proper type guard. |
| MEDIUM | `src/core/controller/ActionExecutor.ts` | 127 | `{ waitUntil: "networkidle" } as any` — bypassing Playwright's narrow string literal type. |
| MEDIUM | `src/core/controller/ActionExecutor.ts` | 633 | `elementType as any` — SemanticMapper type mismatch. |
| MEDIUM | `src/core/inspect/InspectServer.ts` | 214 | `(this.cdpSession as any).send(...)` — CDP session type too narrow. |
| MEDIUM | `src/core/VisionGate.ts` | 367 | `(ssim as any).ssim \|\| (ssim as any).default \|\| ssim` — ssim.js lacks proper ESM types. |
| MEDIUM | `src/core/PolicyEngine.ts` | 179, 207 | `(this as any)._currentAmount` — accessing private field from closure. |
| MEDIUM | `src/core/SelfHealingSelector.ts` | 333 | `(this.options as any)[key]` — dynamic key access on options. |
| MEDIUM | `src/core/SessionSnapshot.ts` | 170 | `[entries, storageType] as any` — type mismatch in storage serialization. |
| MEDIUM | `src/core/PageStateCollector.ts` | 838 | `(this.page as any).isClosed?.()` — Page type missing `isClosed`. |
| MEDIUM | `src/core/CrossOriginManager.ts` | 67 | `command as any` — CDP command type too strict. |
| MEDIUM | `src/core/controller/TaloxController.ts` | 1291, 1295 | `handler as any` — event handler type mismatch with EventBus generics. |
| MEDIUM | `src/core/controller/TakeoverBridge.ts` | 386 | `(globalThis as any).__taloxDispatch__` — global window extension. |
| MEDIUM | `src/core/GhostCursorOverlay.ts` | 239, 259 | `(window as any).__taloxUpdateCursor__` — global window extension. |
| LOW | `src/core/observe/OverlayInjector.ts` | 170 | `payload as any` — event bus type gap. |
| LOW | `src/core/loop/AutonomousLoop.ts` | 517 | `(this.controller as any)._adapt` — reaching into controller internals. |

---

## 3. Console.log in Production Code ✅ (v7.0.3+v7.2.0)

| Severity | File | Line(s) | Description |
|----------|------|---------|-------------|
| HIGH | `src/core/controller/TaloxController.ts` | 314, 328, 356, 384 | Logs inspect server address, video/HAR recording paths. Should use a proper logger (pino/winston) or at least a `TaloxLogger` abstraction. |
| HIGH | `src/core/AutoDialogHandler.ts` | 136 | Logs dialog handling. Should use logger. |
| MEDIUM | `src/core/BrowserManager.ts` | 637 | Large banner-style console.log. Should be gated behind a verbose/debug flag. |
| MEDIUM | `src/core/controller/SessionManager.ts` | 482 | Debug log inside stealth injection. Should be behind a verbose flag. |
| LOW | `src/cli/talox.ts` | ~40 instances | CLI files — console.log is acceptable here but could benefit from a chalk/ora-based CLI logger for consistency. |
| LOW | `src/cli/doctor.ts` | 301, 304 | CLI diagnostic output — acceptable. |

> **Recommended fix:** Create a `src/core/Logger.ts` utility with `debug`/`info`/`warn`/`error` levels. Replace all console.log in `src/core/` with logger calls. CLI layer can keep console.log.

---

## 4. Missing Test Coverage ✅ (v7.2.0)

| Severity | Source File | Missing Test | Notes |
|----------|-------------|-------------|-------|
| HIGH | `src/core/GhostCursorOverlay.ts` | No dedicated test | Cursor overlay logic is complex and untested. |
| HIGH | `src/core/daemon/commandHandler.ts` | No dedicated test | Daemon command handling entirely untested. |
| MEDIUM | `src/core/smart/strategies.ts` | No dedicated test | Strategy definitions/configs untested. |
| MEDIUM | `src/core/OriginHeaders.ts` | Tested (unit) | OK |
| MEDIUM | `src/core/TaloxTools.ts` | Tested (unit) | OK |
| MEDIUM | `src/core/GhostVisualizer.ts` | Tested (unit) | OK |
| MEDIUM | `src/core/smart/DomainMemory.ts` | Tested (unit) | OK |

> **Coverage gaps:** GhostCursorOverlay and daemon/commandHandler are the highest-priority gaps. Most other modules have solid test coverage (90+ test files across unit/integration/e2e).

---

## 5. Dead Code / Unused Exports ✅ (v7.2.0)

| Severity | File | Description |
|----------|------|-------------|
| MEDIUM | `src/presets.ts` | Exported preset objects — verify all are consumed. |
| MEDIUM | `src/core/smart/strategies.ts` | Strategy definitions — check all are referenced by AdaptationEngine. |
| LOW | `src/types/settings.ts` | Legacy compat functions (`resolveLegacyMode`) marked NOSONAR — consider deprecation path. |

> **Note:** A full dead-code analysis requires TypeScript compiler API or `ts-prune`. The codebase appears well-structured with barrel exports in `src/index.ts`.

---

## 6. Package.json Issues ✅ (v7.0.2)

| Severity | Issue | Description |
|----------|-------|-------------|
| HIGH | `bin` script name | The `bin` field uses `"talox": "./dist/cli/talox.js"` which npm may flag. If the entry point is ESM (`"type": "module"`), the file needs a `#!/usr/bin/env node` shebang line. Verify it exists in `src/cli/talox.ts`. |
| MEDIUM | `repository.url` normalization | `"url": "https://github.com/AVANT-ICONIC/Talox"` — npm expects `"git+https://github.com/AVANT-ICONIC/Talox.git"` or the shorthand `"github:AVANT-ICONIC/Talox"`. |
| MEDIUM | `prepare` script runs `npm run build` | This runs on `npm install` and may fail if `tsc` isn't available (e.g., consumers installing from npm). Should guard with `"build": "tsc 2>/dev/null \|\| true"` or use `prepublishOnly` only. |
| LOW | `chromium` in dependencies | `"chromium": "^3.0.3"` is a large binary dependency. Consider making it optional or a peer dependency. |
| LOW | Duplicate `playwright` + `playwright-core` | Both are listed as dependencies. `playwright` already includes `playwright-core`. If using `playwright-core` directly for driver control, only that one is needed. |

---

## 7. Type Safety Gaps 🔄 (v7.1.0+v7.1.1 — page:any, @ts-expect-error, non-null done; index sigs + generic returns remain)

### 7a. `@ts-expect-error` / `@ts-ignore` (11 instances)

| Severity | File | Line | Description |
|----------|------|------|-------------|
| HIGH | `src/core/controller/SessionManager.ts` | 713, 715, 874, 885, 887, 902, 909, 933, 935 | 9 suppressions for stealth injection code accessing `globalThis.chrome`, `navigator.getBattery`, `Navigator.prototype`, etc. These are inherently dynamic but could use a `declare global` augmentation block instead. |
| MEDIUM | `src/core/BrowserManager.ts` | 144 | Internal close — type mismatch on browser cleanup. |
| MEDIUM | `src/core/PageStateCollector.ts` | 809 | Accessibility API not in Playwright types. |

### 7b. Loose `: any` Parameter/Return Types (129 instances)

| Severity | File | Count | Description |
|----------|------|-------|-------------|
| HIGH | `src/core/controller/ActionExecutor.ts` | ~16 | `page: any`, `attentionFrame: any`, `rulesEngine: any` — Playwright Page/Frame types should be used. |
| HIGH | `src/core/InteractionReliability.ts` | ~8 | `page: any`, `context: any` — should use Playwright types. |
| HIGH | `src/core/BrowserManager.ts` | ~7 | `launcher: any`, `launchOptions: any` — should type launcher as `BrowserType`. |
| MEDIUM | `src/core/SessionSnapshot.ts` | 4 | `page: any`, `context: any` — should use Playwright `Page`/`BrowserContext`. |
| MEDIUM | `src/core/ChallengeResolver.ts` | 6 | `page: any` — should use `Page`. |
| MEDIUM | `src/core/HumanMouse.ts` | 3 | `page: any` — should use `Page`. |
| MEDIUM | `src/core/SiteWarmup.ts` | 5 | `page: any` — should use `Page`. |
| MEDIUM | `src/core/PageStateCollector.ts` | ~12 | `el: any`, DOM element evaluations — harder to type precisely but could use `ElementHandle`. |
| MEDIUM | `src/core/ArtifactBuilder.ts` | 3 | `payload: any` — should define action payload types. |
| MEDIUM | `src/core/controller/TaloxController.ts` | 5 | `behavioralDNA: any`, `lastAdaptation: any`, return types — should define interfaces. |
| MEDIUM | `src/core/smart/AdaptationEngine.ts` | 2 | `lastAdaptation: any` — should use `AdaptationResult` interface. |
| MEDIUM | `src/core/FingerprintGenerator.ts` | 3 | `weightedPick` returns — should use generics. |
| LOW | `src/types/index.ts` | 2 | `[key: string]: any` index signature, `exceptions?: any[]` — loose type contracts. |

### 7c. Non-null Assertions (`!` operator)

| Severity | File | Lines | Description |
|----------|------|-------|-------------|
| MEDIUM | `src/types/index.ts` | 329-330 | `prevNodeMap.get(id)!` and `currNodeMap.get(id)!` — should handle missing IDs with a fallback. |
| MEDIUM | `src/core/research/ExperimentRunner.ts` | 74, 79 | `runs[0]!`, `runs[i]!` — should validate array length before access. |
| MEDIUM | `src/core/research/StrategyComposer.ts` | 50-51, 58, 65, 74-75 | Array index `!` assertions — should guard with bounds check. |
| MEDIUM | `src/core/research/SkillVersioning.ts` | 110, 111, 115 | `a.metrics!`, `b.metrics!`, `withMetrics[0]!` — after filter, should assert with a runtime check. |
| LOW | `src/core/research/HypothesisGenerator.ts` | 103 | Array index `!` — should use optional chaining + fallback. |

---

## 8. Known Limitations 🔄 (v7.2.0 — Reddit fragility tagged; Patchright + headless docs remain)

| Severity | Limitation | Description |
|----------|------------|-------------|
| HIGH | Patchright `addInitScript` silently fails | Patchright's `addInitScript` callback never executes. Workaround in place (uses `playwright-core` instead), but this limits future Patchright adoption. Document prominently. |
| HIGH | Headless mode is detectable | Chromium headless is inherently fingerprintable. For sensitive sites, must use headed mode. No fix possible without upstream Chromium changes. |
| MEDIUM | Site warmup is fragile | Reddit "Prove your humanity" bypass relies on double-navigation for edgebucket cookie. If Reddit changes their challenge, this breaks silently. |
| LOW | NOSONAR suppressions (42 instances) | Many `NOSONAR` comments suppress SonarQube warnings. Some are legitimate (deprecated compat), others mask real issues that should be addressed. |

---

## Priority Summary

### Must Fix (HIGH) — 12 items
1. **Package.json `repository.url` normalization** — will cause npm publish warnings
2. **`as any` casts accessing internal state** in TaloxController (4× getActiveStateCollector, _adapt, _actions) — extract typed getters
3. **`page: any` throughout ActionExecutor, InteractionReliability, BrowserManager** — replace with Playwright `Page`/`Frame`/`BrowserContext` types
4. **Console.log in core modules** — TaloxController (4), AutoDialogHandler (1) — implement Logger abstraction
5. **Missing tests for GhostCursorOverlay** — complex overlay logic entirely untested
6. **Missing tests for daemon/commandHandler** — daemon handling untested
7. **9× `@ts-expect-error` in SessionManager stealth injection** — use `declare global` augmentation instead
8. **129 loose `: any` types** — systematic type tightening needed (prioritize public API surface)

### Should Fix (MEDIUM) — 16 items
9. Package.json `prepare` script may fail for consumers
10. `playwright` + `playwright-core` duplication
11. CDP session type too narrow in InspectServer/CrossOriginManager
12. Non-null assertions in research modules without bounds checks
13. Bin script shebang verification
14. `chromium` as direct dependency
15. Console.log in BrowserManager (ungated banner)
16. Dead code audit for presets/strategies
17. ssim.js ESM type compatibility
18. SessionSnapshot Page/Context types
19. ChallengeResolver, HumanMouse, SiteWarmup `page: any`
20. ArtifactBuilder `payload: any`
21. AdaptationEngine/DomainMemory return types
22. Site warmup fragility (Reddit bypass)
23. NOSONAR suppressions audit

### Nice to Have (LOW) — 8 items
24. Biome auto-fixable warnings (optional chains, template literals)
25. CLI console.log → chalk/ora abstraction
26. FingerprintGenerator generic return types
27. Legacy compat deprecation path (settings.ts)
28. Full dead-code analysis with ts-prune
29. Type index signatures in TaloxPageState
30. Patchright addInitScript limitation documentation
31. Headless detection limitation documentation

---

*End of backlog. Total: 36 actionable items across 8 categories.*
