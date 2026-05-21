# TODO

> Quality sprint complete. 36 backlog items resolved. CI green. 1694 tests.

## 🔜 v7.5.0 — External Solver Hooks

- [ ] Define `CaptchaSolver` interface (`detect` + `solve`)
- [ ] Integrate solver into `ChallengeResolver` flow
- [ ] Built-in provider: 2captcha.com (same API as Anti-Captcha)
- [ ] Built-in provider: CapSolver (cheaper, AI-powered)
- [ ] Custom solver support (user provides their own)
- [ ] Autonomous loop integration — auto-detects captcha, calls solver, injects token, retries
- [ ] Tests: mock captcha page + mock solver + verify token injection

## 🔜 v7.6.0 — VLM Plugin Interface

- [ ] Define `VisualReasoner` interface (`(screenshot, question) => answer`)
- [ ] Add `visualReasoning` hook to `PerceptionStack` (defaults to no-op)
- [ ] Plugin registration: `talox.use(new OpenAIVisionReasoner({ apiKey }))`
- [ ] Ship as no-op default — zero dependency bloat
- [ ] Separate optional package: `talox-vlm-openai` (OpenAI Vision / GPT-4o)
- [ ] Docs: how to swap in Claude Vision, Groq LLaVA, local Moondream

## 🔜 v7.7.0 — Interaction Quality Score

- [ ] Define score dimensions: mouse naturalness, typing rhythm, scroll patterns, click timing
- [ ] Real-time scoring per session (0–100%)
- [ ] Feedback loop: `adapted` event carries quality delta
- [ ] AdaptationEngine uses scores to validate strategy effectiveness
- [ ] Debug overlay: live "humanity meter" in headed mode

## ✅ v7.7.0 — Multi-Agent Orchestrator (2026-05-20)

- [ ] `AgentCoordinator` — manages multiple `TaloxController` instances
- [ ] Plan-delegate-observe loop (extends existing autonomous loop)
- [ ] Shared state between agents
- [ ] Parallel execution with result merging
- [ ] CLI: `talox run --agents 3 "scrape top 10 CRM pricing"`

## Later / v8

- [ ] Docker image
- [ ] MCP server
- [ ] Headless-first mode
- [ ] Plugin architecture (community rules + vision detectors)
- [ ] Replay UI (interactive session replay)

## 🔜 v7.8.0+ — Plan-Delegate-Observe Loop

- [ ] LLMPlanner integration: break goals into subtasks dynamically
- [ ] Auto-distribute subtasks to agents via AgentCoordinator
- [ ] Observe results, adapt plan mid-execution
- [ ] Shared state bag between agents
- [ ] Result merging with conflict resolution

## 🔜 Later

- [ ] Docker image
- [ ] MCP server  
- [ ] Headless-first mode
- [ ] Plugin architecture
- [ ] Replay UI
