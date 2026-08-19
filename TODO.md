# TODO

> v8.0.0 shipped. 106 test files, 1946 tests, CI green.

---

## 🟡 v8.1.0 — Plan-Delegate-Observe Loop

- [ ] LLMPlanner integration: break goals into subtasks dynamically
- [ ] Auto-distribute subtasks to agents via AgentCoordinator
- [ ] Observe results, adapt plan mid-execution
- [x] Shared state bag between agents
- [x] Result merging with conflict resolution

### Coordinator foundation now in place

- Successful tasks can publish output through `resultKey`.
- Shared-state collisions support `last-write-wins`, `first-write-wins`, or `reject`.
- Result merging is deterministic in original task order even though agents execute concurrently.
- Coordinator status now tracks live `busy`, `currentUrl`, and `lastResult` values instead of placeholder status data.

---

## 🟢 Later

- [ ] Docker image
- [ ] MCP server
- [ ] Headless-first mode
- [ ] Plugin architecture (community rules + vision detectors)
- [ ] Replay UI (interactive session replay)
- [ ] Cross-origin iframe trust detection (leverages `trust` field from v8.0.0)

---

## ✅ Done

| Version | What | When |
|---------|------|------|
| v8.0.0 | **Content Trust Annotations** — trust field on nodes/elements, ContentSanitizer integration | 2026-05-21 |
| v7.9.0 | **NetworkGuard** — client-side JS egress filtering + Token Benchmarks | 2026-05-21 |
| v7.8.0 | **ContentSanitizer** — prompt injection defense (warn/strict tiers) | 2026-05-21 |
| v7.7.0 | **AgentCoordinator** — multi-agent orchestrator | 2026-05-20 |
| v7.6.0 | **VLM Plugin Interface** — VisualReasoner, CaptchaSolver, InteractionQuality | 2026-05-20 |
| v7.4.0 | Chromium optional dep, CI hardening, backlog resolution | 2026-05-17 |
| v7.3.0 | `as any` / `@ts-expect-error` extermination | 2026-05-17 |
| v7.2.0 | GhostCursorOverlay tests, daemon tests, NOSONAR cleanup | 2026-05-17 |
| v7.1.x | Type safety: 49 `page: any` → `Page`, global declarations | 2026-05-17 |
