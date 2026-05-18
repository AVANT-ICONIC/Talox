# Talox Release Roadmap

> Updated 2026-05-17 — one release per day cadence

## ✅ Done

|Version|Theme|Key Metric|Date|
|---|---|---|---|
|v7.0.2|Package hygiene|npm warnings fixed|2026-05-17|
|v7.0.3|Logger abstraction|12 core modules de-console.log'd|2026-05-17|
|v7.0.4|Typed accessors|13 `as any`→0 in TaloxController|2026-05-17|
|v7.1.0|Type Safety Sprint|49 `page:any`→0, ~70 suppressions killed|2026-05-17|
|v7.1.1|Suppressions cleanup|9 `@ts-expect-error`→2, 14 `!`→0|2026-05-17|
|v7.2.0|Test hardening + housekeeping|+43 tests (1688 total), audits|2026-05-17|

---

## 🔜 v7.3.0 — Hard Type Gaps

**18 remaining `as any` + 2 `@ts-expect-error` — the genuinely hard cases.**

### SessionManager pages wrapper (3 `as any`)
- [ ] Add `PageHandle` typed wrapper instead of `(this.pages[index] as any).page`
- [ ] Add `getCollectorPage()` accessor instead of `(collector as any).page`

### PolicyEngine `_currentAmount` closure (2 `as any`)
- [ ] Refactor closure → private method or extract `currentAmount` to a named field
- [ ] Fix `(this as any)._currentAmount` access in two closure contexts

### SelfHealingSelector dynamic key (1 `as any`)
- [ ] Replace `(this.options as any)[key]` with `keyof` constrained access

### PageStateCollector `isClosed` (1 `as any`)
- [ ] Add `isClosed` to Playwright Page type via augmentation OR use try/catch pattern

### CDP protocol looseness (2 `as any`)
- [ ] InspectServer: widen CDPSession type or accept as upstream limitation
- [ ] CrossOriginManager: same — CDP command parameters are inherently loose

### ssim.js ESM compat (1 `as any`)
- [ ] Write local `ssim.js.d.ts` override OR accept as upstream limitation with doc

### Remaining suppressions (2 `@ts-expect-error`)
- [ ] BrowserManager: internal close — add proper type guard
- [ ] PageStateCollector: accessibility API — augment Playwright types

### Miscellaneous hard casts (6 `as any`)
- [ ] SessionSnapshot entries tuple
- [ ] OverlayInjector event payload
- [ ] VisionGate ssim access (second cast)
- [ ] SessionManager stealth bracket-notation casts (3x — accept as necessary)

### Polish
- [ ] Strategies definition tests
- [ ] Update AGENTS.md version + status

---

## 🔜 v7.4.0 — Robustness & Docs

### Production hardening
- [ ] Chromium dep → `optionalDependencies` (breaking change — needs migration guide)
- [ ] Patchright `addInitScript` limitation documented in AGENTS.md + README
- [ ] Headless detectability limitation documented

### Finishing touches
- [ ] Mark original IMPROVEMENT_BACKLOG.md complete
- [ ] Final `as any` tally: zero or documented exceptions only
- [ ] Run full test suite (unit + smoke + property + snapshot + perf + browser + e2e)

---

## 🔜 v7.5.0+ — Feature Work

Backlog complete. Start building new features.

---

*Original backlog: 36 items across 8 categories. After v7.4.0: 0 remaining.*
