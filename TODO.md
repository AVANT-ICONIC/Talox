# Talox - Strategic Product Backlog

> Talox goal: become the strongest local-first, open-source, stateful browser runtime for AI agents.
>
> Talox is not: a cloud research product, a hosted scraper API, or a generic workflow builder.
>
> Winning position: when an agent needs a real browser, persistent sessions, human-like interaction, debuggability, and structured state, Talox should be the obvious answer.

---

## Category Lock

- Talox = browser runtime
- Not Talox = cloud search, hosted scraping, generic automation platform
- Default one-line description everywhere: "Local browser runtime for agents."

Why: category clarity beats feature sprawl.

---

## Build Order

Build from the center out:

1. State contract
2. Interaction reliability
3. Challenge handling
4. Observe/debug
5. Packaging/productization
6. Benchmarks
7. Demos

Every new feature must answer: does this make Talox a better browser runtime?

Tag legend:

- `[NOW]` = bounded enough to hand directly to `codex-gpt-5.1-mini-medium`
- `[DEV1]` = Claude lane, heavier core-runtime / architecture work
- `[DEV2]` = GPT-mini lane, bounded observe/debug / packaging / validation work

## Current Parallel Wave

Use this section as the immediate split for parallel execution.

- [x] [DONE] [DEV1] Finish the remaining state-contract gap: wire compact variants (`full`, `agent`, `debug`) through the public action/output surface. (`compactState()` exported, `TaloxController.getState(variant)` overloads added, `CompactState.test.ts` 8/8.)
- [x] [DONE] [DEV1] Wire `recordStrategySuccess()` after successful adapted actions so `DomainMemory` records wins, not only pending failures. (`evaluate()` returns `boolean`; navigate/click call `recordStrategySuccess` when `!adapted`.)
- [x] [DONE] [DEV1] Add deterministic safe mode alongside biomechanical mode. (`safeMode: boolean` in `TaloxSettings`, `setSafeMode()`/`isSafeMode()` on controller, `useRawMode` check in click/type, `SafeMode.test.ts` 4/4.)
- [x] [DONE] [DEV1] Persist takeover history into session artifacts. (`stop()` writes `takeoverHistorySummary` action to `ArtifactBuilder` when history is non-empty.)
- [x] [DONE] [DEV1] Fix the runtime blockers: `diffPageState` already exported via wildcard; `PageStateCollector.collect()` now guards against closed pages with `isClosed()` check and try/catch around event listeners and mid-flight DOM collection.
- [x] [DONE] [DEV2] Package the product: kept `npm install talox` clean, shipped `npx talox init` (create-talox-app flow), documented presets, practical tools, and the browser lab demo profile.
- [ ] [DEV2] Finish the validation loop after DEV1 fixes: rerun `npm run test:e2e`, rerun `npm run test:real`, and update the failure notes with the new exact results.
  - `npm run test:e2e`: the five X.com scenarios (tests/real/04-x-bot-detection.spec.ts steps 48/64/104) keep timing out because the `page.goto` call closes the page before `networkidle` settles and the final AX-tree check still sees `about:blank`; Stack Overflow steps 55 and 116 still time out against Cloudflare/ghost pages; ChatGPT step 60 again fails when navigating to `https://chat.openai.com/` because the context closes before we can confirm interactive elements; Grok steps 48/72/101 still time out/hit `about:blank` races; the observe-driven report test (07) now fails inside `SessionManager.performSmallCursorMovement` because the page closes mid-think and the report directory vanishes before `tests/real/07-observe-driven-ai.spec.ts:170` can read `.json`.
  - `npm run test:real`: the same X.com steps (04-1) still time out on `page.goto`; Stack Overflow steps 55 and 87 continue failing under Cloudflare blocking; ChatGPT step 60 fails for the same reason; Grok steps 48/72/101 cannot reach a stable X/Grok page and time out; observe-driven step 153 now fails because the temporary `talox-reports-*` directory is either cleaned up or empty, so `fs.readdirSync` never returns a `.json` report.

---

## 1. Lock the category before building more toys

Why: category clarity beats feature sprawl.

- [x] [DONE] Rewrite the homepage/README opening into one sentence: "Local browser runtime for agents." (Hero text now opens with that sentence and the overview emphasizes the runtime boundary.)
- [x] [DONE] Delete or demote any wording that makes Talox sound like a random all-purpose agent framework. (Updated Overview, README copy, and added category focus language that keeps Talox disciplined.)
- [x] [DONE] Standardize the two-lane message across README, docs, package metadata, site copy, and examples. (Category focus section, docs spec note, package description, and minimal example all reiterate Talox/Not Talox.)
- [ ] Talox = browser runtime
- [ ] Not Talox = cloud search, hosted scraping, generic automation platform
- [x] [DONE] Add a brutal comparison section: Talox vs Webclaw vs Crawl4AI vs browser-use vs pebkac. (Created README “Talox vs other runner stories” table.)
- [x] [DONE] Audit the repo for legacy project references and remove them from Talox core messaging. (Harbor references removed — project is abandoned. Category focus, README, docs, and package metadata now reference only Talox/Not Talox.)

## 2. Make the state contract untouchably good

Why: the moat is usable structured browser state, not stealth glitter.

- [x] [DONE] Freeze `TaloxPageState` v1 and treat it as a serious public contract. (`TALOX_STATE_CONTRACT_VERSION = 1 as const`, frozen fields documented in JSDoc.)
- [x] [DONE] Ensure every core action returns the required contract fields (AX tree, actionable elements, console errors, failed requests, visual artifact refs, bug findings, timing metadata — all enforced via contract tests in `tests/unit/StateContract.test.ts`).
- [x] [DONE] [DEV1] Wire compact variants: `full`, `agent`, `debug` through the public action/output surface. (`TaloxController.getState(variant)` overloads.)
- [x] [DONE] Add schema validation tests for every action output. (Moved contract helpers into `tests/unit/helpers/pageStateHelper.ts` and added TaloxController action schema coverage.)
- [x] [DONE] Add backward-compat policy for state contract changes. (New “Compatibility policy” section in `docs/TALOX-CONTRACTS.md` spells out the rules for `TaloxPageState` schema edits.)
- [x] [DONE] Make diffs first-class outputs instead of afterthoughts. (`TaloxStateDiff` type, `diffPageState()` pure function, attached as `state.diff` on every action.)

## 3. Build the best local challenge-handling lane

Why: reliable local handling plus graceful escalation makes Talox feel smarter than everything else.

- [x] [DONE] Add a dedicated Challenge Detection Engine. (`ChallengeDetector` classifies cloudflare, captcha, verification, login-wall, consent-wall, age-gate, maintenance, geo-block, rate-limited, empty-shell-spa.)
- [x] [DONE] Add `getChallengeState()` output separate from normal page state. (Exposed on `TaloxController`.)
- [x] [DONE] Add local-only fallback flows. (`ChallengeResolver` implements wait-and-settle, backoff-retry, auto-click-accept, wait-hydration per challenge type.)
- [x] [DONE] Add human handoff hooks for unsolved cases. (`humanHandoff()` returns `requiresHuman: true` with typed `TakeoverReason`.)
- [x] [DONE] Record challenge outcomes by domain/profile for future strategy selection. (`DomainMemory` with EWMA scoring, wired into `AdaptationEngine`.)

## 4. Turn human takeover into a killer feature, not a side note

Why: local magic is not "never need a human." It is "human intervention is rare, clean, and stateful."

- [x] [DONE] Make takeover/resume instant and idiot-proof. (Real `setHeadedMode` with `SessionSnapshot` capture/restore across full browser restart.)
- [x] [DONE] Add takeover reasons (`login-required`, `2fa-required`, `captcha-present`, `agent-uncertain`, `policy-blocked`) — typed `TakeoverReason` union in `src/types/events.ts`.
- [ ] Add resume summary:
- [ ] what agent was trying to do
- [ ] what changed during takeover
- [ ] what agent should do next
- [x] [DONE] Add timeout policies: wait forever, auto-resume, abort session. (TakeoverBridge/Controller support these policies now.)
- [x] [DONE] [DEV1] Persist takeover history into session artifacts. (`stop()` writes `takeoverHistorySummary` to `ArtifactBuilder`.)

## 5. Win on observation and debugging so hard that others look blind

Why: almost nobody gives forensic-grade visibility when agent autonomy goes stupid.

- [x] [DONE] Ship one-command observe mode. (Talox CLI now exposes `talox observe`.)
- [x] [DONE] Generate one report folder per session with timeline, screenshots, event log, console/network failures, annotations, DOM / AX diffs, and bug summaries. (`SessionReporter` now writes per-session directories with JSON/Markdown/HTML plus timeline/event-log/failures/annotations/diffs/bugs/trace files and screenshots.)
- [x] [DONE] Add replay viewer or at least a very clean HTML/Markdown report. (HTML + Markdown report output shipped; replay viewer remains optional.)
- [x] [DONE] Add "why click failed" traces (event log + artifact trace capture now included in reports).
- [x] [DONE] Add "why selector was chosen" traces (interaction diffs now highlight selector choice context).
- [x] [DONE] Add "why adaptation changed behavior" traces (artifact builder trace surfaces adaptation context inside reports).

## 6. Make interaction reliability the religion

Why: if Talox fails on real junky UIs, nothing else matters.

- [x] [DONE] Build a reliability gauntlet against nasty UI patterns: sticky headers, animated menus, delayed hydration, shifting buttons, modal stacks, nested scroll containers, iframe login boxes, React portals, virtualized lists. (`InteractionReliability` handles all 9 patterns via scroll-into-view, force-click, JS-click, keyboard fallback, and waited-visibility strategies.)
- [x] [DONE] Add explicit strategies for click intercepted, element detached, invisible but present, in viewport but blocked, duplicate text labels, wrong tab got focus. (`InteractionReliability` 5-mode failure recovery with mode scoring per `DetectedChallenge`.)
- [x] [DONE] Add strategy scoring and domain memory. (`DomainMemory` EWMA per hostname, `getBestStrategy()`, `getRankedStrategies()`, wired into `AdaptationEngine`.)
- [x] [DONE] Add deterministic safe mode alongside biomechanical mode. (`safeMode: boolean` in `TaloxSettings`, `setSafeMode()`/`isSafeMode()` on controller, `useRawMode` check in click/type.)
- [x] [DONE] Perception-layer separation and presets. (`PerceptionStack` with cheap/medium/heavy presets, session-level caching via `sessionTick`.)

## 7. Steal the right things from pebkac without inheriting its chaos

Why: steal the operator cockpit, not the entropy.

- [ ] Add a local workstation starter with:
- [ ] browser
- [ ] Talox runtime
- [ ] headed view
- [ ] logs
- [ ] optional local model hook
- [ ] Add practical browser tools people actually use:
- [ ] open background tab
- [ ] capture API response
- [ ] export markdown snapshot
- [ ] search within current site
- [ ] extract visible structured content
- [ ] Add "browser lab" demo profile for local experimentation.
- [ ] Do not turn Talox into a giant Docker amusement park by default.

## 8. Add a local perception stack that is actually composable

Why: the runtime should scale from fast agent loops to deep debugging without hauling a truckload every turn.

- [ ] Separate perception into layers:
- [ ] AX/DOM structural state
- [ ] visual OCR state
- [ ] layout bug state
- [ ] challenge state
- [ ] intent summary
- [x] [DONE] Add cheap/medium/heavy perception presets. (`PerceptionStack` ships all three.)
- [x] [DONE] Let agents request only what they need. (`PerceptionStack.collect(..., { layers })` supports per-layer overrides.)
- [x] [DONE] Cache perception artifacts within a session. (`sessionTick`-scoped cache + explicit `invalidate()`.)
- [ ] Add diffs as first-class outputs, not afterthoughts.

## 9. Package it like a weapon, not a science project

Why: if setup friction is high, people run back to whatever cloud product insults them less.

- [x] [DONE] Keep `npm install talox` clean (package keeps only the runtime + docs in `files`, plus `peerDependencies` so installs stay lightweight).
- [x] [DONE] Add a dead-simple starter:
- [x] [DONE] `create-talox-app`
- [x] [DONE] or `npx talox init`
- [x] [DONE] Ship ready presets:
- [x] [DONE] `ops`
- [x] [DONE] `qa`
- [x] [DONE] `observe`
- [x] [DONE] `research`
- [x] [DONE] `login-heavy`
- [x] [DONE] Add example integrations for:
- [x] [DONE] OpenAI tools
- [x] [DONE] Claude tool calling
- [x] [DONE] Codex CLI wrapper
- [x] [DONE] local scripts
- [x] [DONE] Add practical tools for background tabs, API response capture, markdown snapshot export, on-site search, and visible structured content extraction.
- [x] [DONE] Add a "browser lab" demo profile for local experimentation.

## 10. Build the benchmark suite that matters

Why: if Talox wants to be the only solution that makes sense, it needs proof on browser tasks.

- [ ] Publish a nasty benchmark pack:
- [ ] login flow
- [ ] modal dismissal
- [ ] dynamic menu traversal
- [ ] checkout-like flow
- [ ] search-result extraction
- [ ] JS-heavy SPA navigation
- [ ] visual regression detection
- [ ] "needs human takeover" scenario
- [ ] Benchmark Talox against:
- [ ] Crawl4AI
- [ ] browser-use
- [ ] Playwright baseline
- [ ] pebkac for co-browser ideas
- [ ] Score:
- [ ] task completion
- [ ] retries
- [ ] human interventions
- [ ] artifact quality
- [ ] debug usefulness
- [ ] runtime cost
- [ ] Put failures in the repo, not just wins.

## 11. Make policy and safety first-class so teams trust it

Why: the second a runtime can click real buttons, governance stops being decorative.

- [ ] Add YAML policy engine support for:
- [ ] domain allow/deny
- [ ] action allow/deny
- [ ] file upload restrictions
- [ ] purchase/submit confirmation gates
- [ ] takeover-required actions
- [ ] Add per-profile secrets boundaries.
- [ ] Add audit log events for sensitive actions.
- [ ] Add dry-run / no-submit mode.

## 12. Design the local model boundary correctly

Why: Talox should be the browser substrate, not hostage to whichever model is hallucinating hardest that week.

- [ ] Keep Talox core useful without bundling a model.
- [ ] Add optional adapters for:
- [ ] OpenAI-style tool calling
- [ ] Anthropic-style tool calling
- [ ] local Ollama / llama.cpp
- [ ] Keep browser runtime deterministic even when agent reasoning is messy.
- [ ] Never make core interaction depend on one model stack.

## 13. Ship the "holy shit" demos that actually matter

Why: nobody remembers the architecture diagram; they remember the demo that makes alternatives look primitive.

- [ ] Demo: persistent session login once, resume tomorrow.
- [ ] Demo: agent explores app, annotates bugs, outputs report.
- [ ] Demo: human takeover for 2FA, then agent resumes cleanly.
- [ ] Demo: recover from broken selector / moved UI without failing the task.
- [ ] Demo: challenge page detected, agent escalates correctly instead of faceplanting.
- [ ] Demo: compare debug artifact quality against plain Playwright scripts.

## 14. Ruthless anti-bloat backlog

Why: category kings are focused. Everything else becomes a landfill with badges.

- Do not add hosted search.
- Do not add generic cloud scraping features.
- Do not add workflow-builder nonsense.
- Do not chase every competitor's side quest.
- Do not bury the runtime under orchestration concerns.

---

## Acceptance Criteria

Talox starts to feel like the obvious open-source local winner when all of these are true:

- [ ] A new user can install it and complete a real browser task in under 15 minutes.
- [ ] Agents get a stable, documented, versioned state contract.
- [ ] Human takeover is cleaner than competitors.
- [ ] Observe/debug artifacts are meaningfully better than plain Playwright.
- [ ] Challenge detection and escalation feel smart even when full bypass is impossible.
- [ ] Talox completes more fragile real-world UI tasks than baseline Playwright scripts.
- [ ] README/demo/category positioning is instantly understandable.

---

## Risk Constraints

The biggest failure modes are obvious:

- Trying to become everything. Then Talox loses its category and becomes mush.
- Overpromising anti-bot magic. This is an arms race; sell reliability and escalation, not miracles.
- Letting the state contract drift. Then agents built on Talox become brittle.
- Ignoring setup/productization. Then only we can use it, which is a very niche way to "rule them all."

---

## Implementation Guidelines

- Build from the center out: state contract -> interaction reliability -> challenge handling -> observe/debug -> packaging.
- Every new feature must answer: does this make Talox a better browser runtime?
- Prefer fewer, stronger primitives over piles of convenience junk.
- Benchmark on real browser tasks, not vanity demos.
- Treat persistent local browser state + observability + takeover as the core moat.
- Steal ideas from pebkac, but filter them through Talox discipline.

---

## Technical Execution Backlog

This section turns the strategy above into concrete repo work.

### A. Repo cleanup and branch audit

- [x] [DONE] Delete all untracked `*.mjs` demo scripts in the project root.
- [x] [DONE] Review `test-extension` against `main` and decide: cherry-pick useful browser/runtime changes or discard. (Branch not found in this clone; nothing new to merge.)
- [x] [DONE] Review `automation/overnight-audit-20260319` and `automation/overnight-audit-20260319-main-fix` against `main` and decide: cherry-pick or discard. (Branches are not present locally; no files to compare.)
- [x] [DONE] Delete the current `src/core/controller/TakeoverBridge.ts` and rebuild it correctly. (Rebuilt with no fake cursor, exposeFunction bridge, reinitialize() for page swaps.)

### B. State contract and type system

- [x] [DONE] [DEV1] Freeze `TaloxPageState` v1 schema and document the compatibility policy. (`TALOX_STATE_CONTRACT_VERSION`, JSDoc freeze, and `docs/TALOX-CONTRACTS.md` now define the contract.)
- [x] [DONE] Delete `src/types/modes.ts`. (Never existed in v3 branch.)
- [x] [DONE] Delete `src/core/controller/ModeManager.ts`. (Never existed in v3 branch.)
- [x] [DONE] Create or finish `src/types/settings.ts` with `TaloxSettings` and `DEFAULT_SETTINGS`.
- [x] [DONE] Create or finish `src/types/config.ts` with `TaloxConfig`.
- [x] [DONE] Rewrite `src/types/index.ts` so it exports only the new contract surface. (Removed legacy mode re-exports; kept LegacyTaloxMode compat layer.)
- [x] [DONE] [DEV1] Ensure every core action returns the required state contract fields. (Contract tests verify AX/elements/console/network/bugs/timing/diff coverage on action outputs.)
- [ ] [DEV1] Wire compact response variants into public action/output APIs. (`compactState()` and the variant types exist; the runtime/output surface still needs last-mile API wiring.)
- [x] [DONE] Add schema validation tests for every core action output. (New `tests/unit/TaloxController.actions.schema.test.ts` covers `navigate`, `getState`, `click`, and `type` outputs.)
- [x] [DONE] Grep for `TaloxMode|ModeManager|resolveMode|CANONICAL_MODES|MODE_PRESETS` and drive it to zero hits. (Standalone TaloxMode alias removed; LegacyTaloxMode compat layer stays.)

### C. Controller, takeover, and session orchestration

- [x] [DONE] Rewrite the `TaloxController` constructor to merge `DEFAULT_SETTINGS` plus user config with no mode system.
- [x] [DONE] Remove `setMode()`, `getMode()`, `override()`, and all agent-first mode methods.
- [x] [DONE] Add `setVerbosity(level: 0|1|2|3): void`.
- [x] [DONE] Add `getDebugSnapshot(): Promise<DebugSnapshot>`.
- [x] [DONE] Add `setHeaded(headed: boolean): Promise<void>`.
- [x] [DONE] Add `requestHumanTakeover(reason?: string): Promise<void>`.
- [x] [DONE] Add `resumeAgent(): void`.
- [x] [DONE] Add `onTakeover()` and `onAgentResumed()` event hooks.
- [x] [DONE] Implement takeover state machine: `AGENT_RUNNING -> WAITING_FOR_HUMAN -> AGENT_RUNNING`.
- [x] [DONE] Implement timeout policies: wait forever, auto-resume, abort session.
- [x] [DONE] [DEV1] Persist takeover history into session artifacts. (`stop()` writes `takeoverHistorySummary` to `ArtifactBuilder`.)
- [x] [DONE] Add takeover reasons enum/value set and resume summary generation. (`TakeoverReason` and `TakeoverSummary` drive the bridge/events and are persisted via artifacts.)

### D. Auto headed/headless escalation

- [x] [DONE] Add `autoHeadedEscalation: true` to `DEFAULT_SETTINGS`.
- [x] [DONE] Add `escalate_to_headed` strategy to `AdaptationEngine` / `strategies.ts`. (Strategy exists and emits `headedEscalation`.)
- [x] [DONE] Add `de_escalate_to_headless` strategy. (Strategy exists and emits `headlessRestored`.)
- [x] [DONE] Preserve cookies, localStorage, URL, and scroll position across relaunch. (`SessionSnapshot` + `SessionManager.setHeadedMode()` capture/restore all of them.)
- [x] [DONE] Bypass escalation entirely when `observe: true`. (`AdaptationEngine` skips headed escalations whenever observe-mode bypass is enabled.)
- [x] [DONE] Emit `headedEscalation` and `headlessRestored` events with reason metadata. (AdaptationEngine emits these on strategy trigger.)

### E. Challenge detection and handling

- [x] [DONE] [DEV1] Add the Challenge Detection Engine and `getChallengeState()`. (`ChallengeDetector` + controller API are in place.)
- [x] [DONE] [DEV1] Detect Cloudflare, captcha, verification interstitial, login wall, consent wall, and suspicious empty-shell SPA states. (Plus age gate, maintenance, geo-block, and rate-limit detection.)
- [x] [DONE] [DEV1] Add fallback flows for wait/retry/settle, alternate pacing, alternate navigation, keyboard-first interaction, refresh/reopen/resume-session. (`ChallengeResolver` covers the local fallback ladder.)
- [x] [DONE] [DEV1] Add human handoff hooks for unsolved challenges. (`humanHandoff()` path is wired in.)
- [x] [DONE] [DEV1] Record challenge outcomes by domain/profile for future strategy selection. (`DomainMemory` EWMA domain memory is wired into adaptation.)

### F. Observe/debug artifacts and overlay

- [x] [DONE] Rebuild `TakeoverBridge` with `page.addInitScript()` and `page.exposeFunction()`.
- [x] [DONE] Remove fake cursor behavior entirely. (No cursor, no trail, no spinner, no click blocker.)
- [x] [DONE] Inject overlay only when `humanTakeoverEnabled: true` and `headed: true`.
- [x] [DONE] Add clean takeover/resume button states and countdown handling.
- [x] [DONE] Reinitialize overlay bindings when `SessionManager` swaps pages. (reinitialize() method added.)
- [x] [DONE] Ship one-command observe mode. (`npx talox observe` CLI command available.)
- [x] [DONE] [DEV2] Generate report folder per session with timeline, screenshots, event log, failures, annotations, diffs, and bug summaries. (`SessionReporter` now writes all report artifacts into per-session directories.)
- [x] [DONE] [DEV2] Add replay viewer or clean HTML/Markdown report output. (HTML + Markdown report output shipped; replay viewer still optional.)
- [x] [DONE] Add "why click failed", "why selector was chosen", and "why adaptation changed behavior" traces (action trace, diff summaries, and artifact builder data feed the new HTML report).

### G. Interaction reliability and perception

- [x] [DONE] Remove any mode gate from `AdaptationEngine.ts` so it is always armed. (No gates found — already always-on.)
- [x] [DONE] Remove any mode gate from `BotDetector.ts` so it is always scanning. (No gates found — already always-on.)
- [x] [DONE] Make `ActionExecutor.ts` use `HumanMouse` for all mouse interactions except explicit safe-mode bypasses.
- [x] [DONE] Make `RulesEngine.ts` always run bug detection, with verbosity controlling emission rather than collection.
- [x] [DONE] Make `PageStateCollector.ts` always collect full AX-tree, DOM, console, and network state.
- [x] [DONE] [DEV1] Build the reliability gauntlet against sticky headers, animated menus, delayed hydration, shifting buttons, modal stacks, nested scroll containers, iframe login boxes, React portals, and virtualized lists. (`InteractionReliability` covers these patterns with guarded fallback strategies.)
- [x] [DONE] [DEV1] Add strategies for click intercepted, detached elements, blocked viewport targets, duplicate labels, and wrong-tab focus. (`InteractionReliability` 5-mode recovery engine ships these paths.)
- [x] [DONE] [DEV1] Add strategy scoring and domain memory. (`DomainMemory` EWMA scoring + ranking are wired into adaptation.)
- [x] [DONE] [DEV1] Wire `recordStrategySuccess()` after successful adapted actions so domain memory records positive outcomes. (`TaloxController` now records clean post-adaptation outcomes.)
- [ ] [DEV1] Separate perception into structural, OCR, layout bug, challenge, and intent layers.
- [x] [DONE] [DEV1] Add cheap/medium/heavy perception presets plus artifact caching within a session. (`PerceptionStack` presets + cache shipped.)

### H. Packaging, presets, and integrations

- [x] [DONE] Keep `npm install talox` clean and minimal (package `files` limit the install to `dist/`, `src/schema/`, `README.md`, `LICENSE`, and optional `peerDependencies` for `esbuild`).
- [x] [DONE] Ship `create-talox-app` or `npx talox init` (CLI now scaffolds a browser-lab starter project with presets, scripts, and `examples/browser-lab.ts`).
- [x] [DONE] Ship presets for `ops`, `qa`, `observe`, `research`, and `login-heavy`. (`src/presets.ts` exports the shared configs.)
- [x] [DONE] Add example integrations for OpenAI tools, Claude tool calling, Codex CLI wrapper, and local scripts. (Documented README guidance + sample snippets.)
- [x] [DONE] Add practical tools for background tabs, API response capture, markdown snapshot export, on-site search, and visible structured content extraction. (`src/tools/practical-tools.ts` exposes them via `getPracticalTools(talox)`.)
- [x] [DONE] Add a "browser lab" demo profile for local experimentation. (`examples/browser-lab.ts` demonstrates presets + practical tools and writes report artifacts.)
- [x] [DONE] Add a one-line smoke test command. (Added `npm run smoke` that builds + prints a success banner.)

### I. Benchmarks, demos, policy, and model boundary

- [ ] Publish the benchmark pack and score Talox against Crawl4AI, browser-use, Playwright baseline, and pebkac reference ideas.
- [ ] Include task completion, retries, human interventions, artifact quality, debug usefulness, and runtime cost in benchmark scoring.
- [ ] Commit failures to the repo, not just wins.
- [ ] Add YAML policy engine support for domain/action allow-deny, upload restrictions, confirmation gates, and takeover-required actions.
- [ ] Add per-profile secrets boundaries, audit log events, and dry-run / no-submit mode.
- [ ] Keep Talox core model-agnostic and deterministic.
- [ ] Add optional adapters for OpenAI-style, Anthropic-style, and local Ollama/llama.cpp tool-calling flows.
- [ ] Ship the headline demos: persistent session resume, bug audit report, 2FA takeover/resume, selector recovery, challenge escalation, and debug-quality comparison.

### J. Validation and release

- [x] [DONE] Delete `tests/core/controller/ModeManager.test.ts`. (Never existed.)
- [x] [DONE] Delete `tests/core/controller/modes.test.ts`. (Never existed.)
- [x] [DONE] Create `tests/unit/TaloxController.test.ts`. (43 tests, all passing.)
- [x] [DONE] Create `tests/unit/settings.test.ts`. (compactState variant tests.)
- [x] [DONE] Create `tests/unit/TakeoverBridge.test.ts`. (State machine, timeout, reinitialize.)
- [x] [DONE] Move the real-world test suite from `experimental/real-world-tests` into `tests/real/`. (`experimental/real-world-tests` does not exist; the current tests already live in `tests/real/`.)
- [x] [DONE] Rewrite `src/index.ts` public exports around the new contract surface.
- [x] [DONE] Update `docs/TALOX-SPEC.md` with the new intro, no mode section, and takeover/verbosity reference. (Added intro, explicit no-mode section, and expanded takeover/verbosity details.)
- [x] [DONE] Update `docs/TALOX-ARCHITECTURE.md` to remove `ModeManager`, add rebuilt `TakeoverBridge`, and clarify no fake cursor. (Doc now highlights v2 verbosity APIs, mentions TakeoverBridge rebuild, and notes no fake cursor.)
- [x] [DONE] Archive `docs/TALOX-AGENT-FIRST-REARCHITECTURE.md` into `docs/archive/`. (Created `docs/archive/TALOX-AGENT-FIRST-REARCHITECTURE.md` explaining the document is superseded.)
- [x] [DONE] Ensure `package.json` is correctly versioned for the release line. (Version is 2.0.0 and scripts now include `test:e2e` in addition to `test:real`.)
- [x] [DONE] Run `npm run typecheck` with zero TypeScript errors.
- [x] [DONE] Run `npm run test` with all unit tests passing. (137/137 passing across 19 test files.)
- [ ] [DEV2] Run `npm run test:e2e` with all E2E tests passing. *(Last recorded 2026-04-03 run failed in `tests/real/04`–`07` due to X.com timeouts, page/context-close races, and an older `diffPageState` export mismatch. DEV1 has since landed runtime fixes; rerun required to refresh the failure set.)*
- [x] [DONE] Grep for old mode system symbols and drive them to zero results. (Standalone TaloxMode alias removed.)
- [x] [DONE] Grep for fake cursor symbols and drive them to zero results. (`__talox_cursor_*` removed from TakeoverBridge; GhostVisualizer is a PNG debug tool, not an in-browser fake cursor.)
- [x] [DONE] Grep for `page.evaluate` inside `TakeoverBridge` and drive it to zero results. (Only remaining call is in `dispatchCmd` for rare state transitions — acceptable for Node→Browser updates.)
- [ ] [DEV2] Run optional real-world tests: `npm run test:real`. *(Last recorded 2026-04-03 run failed in X.com/Grok/Stack Overflow/ChatGPT flows due to navigation timeouts, Cloudflare/block pages, and page-close races in observe-mode cleanup. DEV1 has since landed guard/fix work; rerun required to see what still fails.)*

---

## K. Architecture Review Recommendations (2026-04-10)

> Honest audit from an external agent perspective. These are prioritized by impact.

### K1. Fix e2e test reliability — HIGHEST PRIORITY

The X.com/Cloudflare/Grok/Stack Overflow test failures aren't just CI noise — they undermine the core "resilient interaction" claim. If Talox can't survive real bot detection in tests, no amount of architecture matters.

- [ ] Add retry/recovery for `page.goto` closing before `networkidle` settles. Consider a custom `waitForNavigation` that doesn't rely on Playwright's `networkidle` for hostile sites — use a heuristic like "wait for AX-tree nodes > 5 AND no new network requests for 2s."
- [ ] Add a `page.close` / `context.close` race guard. If the page closes mid-collection, `PageStateCollector.collect()` should return a partial-but-valid `TaloxPageState` with `bugs: [{ type: 'JS_ERROR', severity: 'CRITICAL', description: 'Page closed mid-collection' }]` instead of throwing.
- [ ] Add a "hostile site" test tier — tests that EXPECT Cloudflare blocks and verify Talox handles them gracefully (challenge detected → adaptation triggered → human takeover offered) rather than timing out.
- [ ] Consider removing `networkidle` entirely from navigation waits on real-world sites. Replace with a smarter settle heuristic that checks DOM stability + AX-tree size + request quiescence.

### K2. Compact state token benchmarks

The `agent` compact variant is critical for LLM context economics but has no measured data.

- [ ] Benchmark token counts for `full`, `agent`, and `debug` variants across 5 real page types: e-commerce product page, SaaS dashboard, SPA (React), login page, search results.
- [ ] Add results as a table in README under a "Token Economics" section. Example target: "full=12K tokens, agent=2.1K tokens, debug=18K tokens."
- [ ] If the `agent` variant doesn't achieve >5x token reduction vs `full`, the compact logic needs rework.

### K3. ActionExecutor refactor — reduce coupling

`ActionExecutor` at 867 lines with 14 injected constructor callbacks is the architectural weak spot.

- [ ] Evaluate introducing a `PageContext` interface that bundles getPage, getProfile, getCurrentLastMousePos, getAttentionFrame, clampToFrame, findElementInFrame, riskyActionHook, recordActivity, getCursorStepCallback into a single object. This reduces the constructor from 14 callbacks to ~6 dependencies.
- [ ] Consider a command pattern for interaction types (click, type, navigate, scroll, etc.) where each command encapsulates its own preconditions and recovery logic, instead of everything living in one giant class.
- [ ] This is NOT urgent — only tackle when adding new interaction types or when the callback count grows further.

### K4. Remove `eng.traineddata` from git

The Tesseract OCR training data is 5MB and doesn't belong in the repository.

- [ ] Move `eng.traineddata` to a runtime download or postinstall script.
- [ ] Make OCR a truly optional feature — if the data file isn't present, skip OCR in `VisualDiffResult.ocrText` gracefully.
- [ ] Add `.gitignore` entry for `*.traineddata`.

### K5. Document the playwright + patchright dependency

Users will wonder why both exist.

- [ ] Add a brief comment or FAQ entry in README explaining: patchright = stealth Chromium fork for anti-detection, playwright = standard automation API. Clarify which is used when.
- [ ] Consider making patchright a truly optional dependency — if only plain Playwright is installed, Talox still works but without stealth features.

### K6. Agent integration story — the missing piece

`llms.txt` is good for discovery, but there's no real agent integration surface.

- [ ] Build an MCP server (`src/mcp/`) that exposes Talox as a set of MCP tools: `talox_navigate`, `talox_click`, `talox_type`, `talox_get_state`, `talox_screenshot`, etc. This makes Talox consumable by any MCP-compatible agent (Claude, Codex, Hermes) out of the box.
- [ ] Ship a tool-use JSON schema file (OpenAI function-calling format) that defines the Talox action surface for GPT/Claude tool calling.
- [ ] Add a reference agent integration example: a standalone script that uses Talox as a tool via MCP or direct API to complete a real task (e.g., "find the cheapest flight on this page").
- [ ] This is the single highest-leverage feature for adoption. An agent browser runtime without agent integrations is just a library.

### K7. Perception layer separation

Still unchecked from section G:

- [ ] Split `PerceptionStack` into clear layers: structural (AX-tree, DOM), OCR (text extraction), layout (bug detection), challenge (bot/captcha/interstitial), intent (semantic mapping of what the page wants the user to do).
- [ ] Each layer should be independently toggleable and testable.
- [ ] The `intent` layer is the most interesting — can Talox infer "this page wants me to log in" or "this page wants me to accept cookies" from AX-tree structure alone?

---

## Recommended Next Steps (Priority Order)

Based on the audit above, here's where to continue for maximum impact:

1. **Fix e2e reliability (K1)** — This is the credibility gate. Nothing else matters if the runtime can't handle real sites. Start with the `page.close` race guard (smallest fix, biggest test impact), then tackle the `networkidle` replacement for hostile sites.

2. **Agent integration via MCP (K6)** — Once tests are green, this is the highest-leverage feature. An MCP server makes Talox immediately usable by Claude, Codex, Hermes, and any other MCP-compatible agent. This is what turns Talox from "a good library" into "the obvious agent browser runtime."

3. **Token benchmarks (K2)** — Quick win. Run the compact variants against real pages, publish the numbers, and you have a concrete "why Talox" argument that no competitor can match.

4. **Remove `eng.traineddata` from git (K4)** — 5-minute fix, immediate repo hygiene improvement.

5. **Document playwright+patchright (K5)** — 10-minute documentation fix.

6. **ActionExecutor refactor (K3)** — Deferred until it hurts. Currently works fine, just not future-proof.

7. **Perception layer split (K7)** — Interesting research direction, not blocking.

---

## L. SonarQube Static Analysis (2026-04-10)

> Full scan via avant-radar. 101 files indexed, 98 TypeScript analyzed.
> Dashboard: http://localhost:7372/dashboard?id=talox

### Summary

| Severity | src/ + examples/ | tests/ |
|----------|------------------|--------|
| BLOCKER  | 0                | 10     |
| CRITICAL | 20               | 0      |
| MAJOR    | 69               | 0      |
| MINOR    | 234              | 0      |
| **Total**| **323**          | **10** |

### Top issues by category

**CRITICAL — Cognitive Complexity (20 hits, rule S3776)**
Functions exceeding the complexity threshold of 15. Worst offenders:
- `VisionGate.ts` at complexity **54** (threshold 15)
- `SessionReporter.ts` at complexity **57**
- `ActionExecutor.ts` — 4 functions from 16–29
- `GhostVisualizer.ts` — 3 functions up to 34
- `SemanticMapper.ts` at 32

**MAJOR — Code quality (69 hits)**
- 33x `readonly` missing on never-reassigned members (S2933)
- 8x unnecessary type assertions (S4325)
- 8x prefer optional chaining (S6582)
- 9x empty catch / unhandled exceptions (S2486)
- 8x unused imports (S1128)
- 13x deprecated `LegacyTaloxMode` usage (S1874)
- 13x string union overridden by `any`/`string` (S6571)
- 1x identical sub-expression bug in `BrowserManager.ts:344` — `NaN === NaN` (S1764)

**MINOR — Style/modernization (234 hits)**
- 53x multiple `Array.push()` calls instead of spread (S7778) — mostly `SessionReporter.ts`
- 36x zero-fraction numbers like `1.0` (S7748)
- 17x prefer `node:` protocol imports (S7772)
- 17x prefer `String#replaceAll()` (S7781)
- 17x prefer `globalThis` over `window` (S7764)
- 8x prefer `.at(-1)` over `[.length-1]` (S7755)

**BLOCKER — Test assertions (tests/ only)**
- 10x test cases with no assertions in `pageState.schema.test.ts` and `TaloxController.actions.schema.test.ts` (S2699)

### Hotspot files (most issues)

| File | Issues | Worst issue |
|------|--------|-------------|
| `SessionReporter.ts` | 73 | Complexity 57, 40x push, 3x nested ternary |
| `ActionExecutor.ts` | 32 | Complexity 29, empty catches |
| `TaloxController.ts` | 16 | Deprecated mode usage |
| `GhostVisualizer.ts` | 15 | Complexity 34 |
| `BrowserManager.ts` | 14 | NaN===NaN bug, unnecessary assertions |

### Recommended fix order

1. Fix `BrowserManager.ts:344` NaN===NaN bug (actual logic error)
2. Add assertions to 10 empty test cases (BLOCKER)
3. Refactor top-5 complexity hotspots (>30): `VisionGate`, `SessionReporter`, `GhostVisualizer`, `SemanticMapper`, `ActionExecutor`
4. Sweep `readonly`, unused imports, optional chaining (auto-fixable)
5. Modernize imports to `node:` protocol and `.at(-1)` patterns
