---
date: 2026-10-08
type: added
scope: browser-engine
title: Add supervised Lightpanda hybrid tasks alongside Chromium
---

Added `src/core/browser/` with capability contracts, supervised direct CDP Lightpanda 1.0.0 workers, a Chromium adapter using BrowserManager, deterministic AUTO/MACHINE/HUMAN routing, bounded queues/deadlines, session binding, safe single fallback, and resource telemetry. `TaloxController.runBrowserTask()` preserves rendered page-state and persistent Chromium APIs. Policy, request guards, approval, shutdown, and human takeover remain enforced; ambiguous mutations are never replayed.

Added the Inspect engine selector and live telemetry, a pinned official installer with SHA256 verification, local fixture benchmarks, public configuration/docs, and focused lifecycle/routing/session/UI/security tests. All Chrome launches through BrowserManager retain mock-keychain/basic-password-store flags after caller overrides. No dependency added, composed ledger edited, test belief removed, or push performed. This repository had no existing `.ledger/changelog` fragment template; this fragment initializes a dated typed record without changing composed documents.

Measurements: both raw adapters passed 27/27 supported fixture attempts; three authenticated-context exclusions each. Complete-task p50/p95: Chromium 203.01/242.18 ms, Lightpanda 179.14/250.15 ms (lower median, higher p95 for Lightpanda). Concurrency above one was blocked by measured shared CPU pressure (and large Chromium memory projections). Full evidence and measurement limits: `docs/benchmarks/lightpanda.json` and `docs/LIGHTPANDA.md`.

Final validation: Node 22.23.2 ran eight explicitly named hybrid test files with `TALOX_ENGINE_INTEGRATION=1`: 117 passed, 0 failed, 0 skipped, including all four genuine browser workflows. Eight explicitly named existing Chromium/Inspect Vitest files: 72 passed, 0 failed. TypeScript build and strict typecheck passed; focused lint checked 14 source files; all 11 added `.mjs` files passed syntax checks. No full suite was run. Logs: `.apex/hybrid-tests.tap` and `.apex/chromium-regression-tests.log`.

- [ ] Operator visual sign-off — screenshots: `.apex/lightpanda-engine-dashboard.png`.
- [ ] Adopt the additive routed-task API in existing CLI/autonomous workflows where their state contracts permit it; persistent workflows remain Chromium.
- [ ] Validate native Linux/Intel binaries, representative framework SPAs and complex authenticated transactions.
- [ ] Repeat multiple process-cold startup runs and 10/25/50-worker batches on an idle host; measure steady-state memory and prolonged memory growth.
- [ ] Review safe cookie-write/import support and any future Lightpanda process reuse against proven session isolation.
- [ ] Expand automatic routing to untrusted content only when upstream CSP/security capability coverage is verified.

Radar: radar down (localhost:7373 unreachable). Apex-specific ownership/shell/self-signal/failed-reading/belief scripts and tests are absent from TALOX; no tools or shell files were added. Focused TALOX checks and exact commands are recorded in the delivery response.
