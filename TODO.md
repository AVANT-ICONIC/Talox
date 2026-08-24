# TODO

> v8.1.0 shipped. Multi-agent coordination, skill loading hardening, Docker packaging, sandboxed Chromium support, dependency-audit maintenance, MCP, community plugins, Replay UI, and cross-origin iframe trust are now on `main`.

---

## ✅ v8.1.0 — Plan-Delegate-Observe Loop

- [x] LLMPlanner integration: break goals into subtasks dynamically
- [x] Auto-distribute subtasks to agents via AgentCoordinator
- [x] Observe results, adapt plan mid-execution
- [x] Shared state bag between agents
- [x] Result merging with conflict resolution
- [x] Wire `talox run --agents N` to `PlanDelegateObserveLoop` when `N > 1`
- [x] Add browser-backed E2E coverage for a real two-agent coordination run
- [x] Validate `AgentCoordinator({ agents })` as a positive integer before launch/distribution
- [x] Make multi-agent launch atomic: clean up already-started agents if a later launch fails

### Runtime foundation now in place

- `PlanDelegateObserveLoop` performs observe → plan → delegate → merge → observe → replan waves.
- `LLMPlanner` receives agent IDs, per-agent browser state, shared state, recent wave summaries, and prior merge conflicts.
- Planner steps can target `args.agentId`; missing or invalid assignments fall back to deterministic round-robin distribution.
- Successful tasks can publish output through `resultKey`.
- Shared-state collisions support `last-write-wins`, `first-write-wins`, or `reject`.
- Result merging is deterministic in original task order even though agents execute concurrently.
- Coordinator status tracks live `busy`, `currentUrl`, and `lastResult` values instead of placeholder status data.
- Coordinated planning fails closed on malformed steps, planner errors, bootstrap failures, and runtime execution errors instead of throwing out of the loop.
- A final read-only planner verification avoids false `max-waves` failures when the last execution wave completed the goal.
- Published `talox` CLI routing sends `run --agents N` with `N > 1` into coordinated mode while preserving the existing CLI for single-agent and other commands.
- Coordinated runs load domain skills and inject matching skill context into planning.
- Progress observers are isolated so reporting failures cannot terminate browser coordination.
- Multi-agent browser launch is atomic and rejects invalid agent counts before starting browsers.
- Browser integration coverage exercises two real Chromium-backed Talox agents across navigation, shared evidence, independent interaction, and replanning.
- Single-agent `AutonomousLoop` loads configured skills before domain matching.
- Skill manifests preserve numeric-looking versions such as `version: 1.0` as strings.
- Docker packaging uses Playwright-managed Chromium, a non-root runtime, and an opt-in sandbox path proven with a matching seccomp profile.
- Dependency maintenance keeps both the production and full npm graphs free of known advisories.
- BrowserManager is headless-first by default; autonomous single- and multi-agent `run` paths stay headless while interactive `observe`/`chat` explicitly opt into headed mode.

---

## ✅ Post-v8.1 work landed on main

- [x] MCP stdio server with modern + legacy protocol handshakes and persistent Talox controller tools (#28)
- [x] Plugin architecture for community rules + vision detectors with isolation and validation (#29)
- [x] Offline Replay UI with timeline, screenshots, action inspection, playback controls, and hardened artifact loading (#30)
- [x] Cross-origin iframe trust detection using existing `trustedDomains`, stable frame identity, and frame-scoped CDP enforcement (#31)

---

## 🟢 Next

- [ ] Platform Adapters: pre-built adapters for common sites and CMSes
- [ ] Local VLM Integration: optional quantized local vision provider(s) behind the existing `VisualReasoner` interface

---

## ✅ Done

| Version / state | What | When |
|---------|------|------|
| main after v8.1.0 | **MCP + Plugins + Replay + Iframe Trust** — agent integration, community extension points, offline debugging, trust-gated cross-origin frame execution | 2026-08-24 |
| v8.1.0 | **Plan-Delegate-Observe** — deterministic multi-agent planning, shared state, CLI routing, domain skills, lifecycle hardening, real two-browser coverage | 2026-08-20 |
| v8.0.0 | **Content Trust Annotations** — trust field on nodes/elements, ContentSanitizer integration | 2026-05-21 |
| v7.9.0 | **NetworkGuard** — client-side JS egress filtering + Token Benchmarks | 2026-05-21 |
| v7.8.0 | **ContentSanitizer** — prompt injection defense (warn/strict tiers) | 2026-05-21 |
| v7.7.0 | **AgentCoordinator** — multi-agent orchestrator | 2026-05-20 |
| v7.6.0 | **VLM Plugin Interface** — VisualReasoner, CaptchaSolver, InteractionQuality | 2026-05-20 |
| v7.4.0 | Chromium optional dep, CI hardening, backlog resolution | 2026-05-17 |
| v7.3.0 | `as any` / `@ts-expect-error` extermination | 2026-05-17 |
| v7.2.0 | GhostCursorOverlay tests, daemon tests, NOSONAR cleanup | 2026-05-17 |
| v7.1.x | Type safety: 49 `page: any` → `Page`, global declarations | 2026-05-17 |
