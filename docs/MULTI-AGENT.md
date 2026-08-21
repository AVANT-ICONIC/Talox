# Multi-Agent Coordination

Talox's `AgentCoordinator` runs browser tasks across multiple isolated Talox controllers. Tasks assigned to different agents execute concurrently, while tasks assigned to the same agent stay sequential.

## Shared state

The coordinator owns a process-local shared state bag that persists across `run()` calls. Use it to carry planning context, intermediate findings, or merged agent outputs between coordination waves.

```ts
import { AgentCoordinator } from "talox";

const coordinator = new AgentCoordinator({
  agents: 3,
  initialSharedState: { goal: "compare CRM pricing" },
});

coordinator.setSharedValue("phase", "research");
console.log(coordinator.getSharedValue("phase"));
console.log(coordinator.getSharedState());
```

`getSharedState()` returns a shallow frozen snapshot. `clearSharedState()` resets the bag and can optionally seed a replacement snapshot.

## Publishing task results

Add `resultKey` to a task to publish successful task output into shared state after the batch finishes.

```ts
const result = await coordinator.run([
  {
    agentId: 0,
    action: "navigate",
    params: { url: "https://example.com/a" },
    resultKey: "sourceA",
  },
  {
    agentId: 1,
    action: "navigate",
    params: { url: "https://example.com/b" },
    resultKey: "sourceB",
  },
]);

console.log(result.sharedState.sourceA);
console.log(result.sharedState.sourceB);
```

Agents still execute concurrently. Talox merges `resultKey` outputs afterward in the original task order so merge behavior does not depend on whichever browser happened to finish first.

## Conflict handling

The default strategy is `last-write-wins`. Configure a coordinator-wide default or override it per task.

```ts
const coordinator = new AgentCoordinator({
  agents: 2,
  conflictStrategy: "first-write-wins",
});

const result = await coordinator.run([
  {
    agentId: 0,
    action: "getState",
    resultKey: "winner",
  },
  {
    agentId: 1,
    action: "getState",
    resultKey: "winner",
    conflictStrategy: "reject",
  },
]);

console.log(result.conflicts);
```

Supported strategies:

- `last-write-wins` — accept the incoming value and replace the current one.
- `first-write-wins` — keep the existing value and reject the incoming one.
- `reject` — reject the incoming value and record the collision explicitly.

Equal values are treated as idempotent writes and do not create a conflict.

## Agent status

`getStatus()` returns snapshots of the coordinator's current runtime status rather than placeholder values.

```ts
for (const agent of coordinator.getStatus()) {
  console.log(agent.id, agent.busy, agent.currentUrl, agent.lastResult?.success);
}
```

Each status entry tracks:

- `busy` while that agent is processing its assigned batch.
- `currentUrl` after state collection.
- `lastResult` from the most recently completed task.

## Lifecycle guarantees

`AgentCoordinator` rejects non-positive or fractional agent counts before starting browser work. Multi-agent launch is atomic from the coordinator's perspective: if a later agent fails to launch, Talox stops the failing controller and every controller that already started before rethrowing the original launch error.

## Plan → Delegate → Observe → Replan

`PlanDelegateObserveLoop` turns the coordinator into an adaptive multi-agent runtime. It asks the existing `LLMPlanner` for one coordination wave at a time, executes that wave through `AgentCoordinator`, feeds fresh browser state and shared state back to the planner, and repeats until the planner reports the goal is complete or the execution budget is exhausted.

```ts
import {
  AgentCoordinator,
  PlanDelegateObserveLoop,
} from "talox";

const coordinator = new AgentCoordinator({
  agents: 3,
  baseDir: ".talox/profiles",
});

await coordinator.launch({ profileClass: "ops", headed: false });

try {
  const loop = new PlanDelegateObserveLoop(coordinator, {
    goal: {
      description: "Compare pricing and core features for three CRM products",
      maxIterations: 6,
    },
    planner: {
      model: "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    },
    skillsDir: "./skills",
    onProgress(wave) {
      console.log(
        `wave ${wave.wave}: ${wave.result.results.filter((r) => r.success).length}/${wave.tasks.length} tasks succeeded`,
      );
    },
  });

  const result = await loop.run();
  console.log(result.status, result.stopReason, result.sharedState);
} finally {
  await coordinator.stop();
}
```

Progress callbacks are observers only. If an `onProgress` callback throws, Talox isolates that reporting failure and continues browser coordination.

### What the planner sees

When `LLMPlanner` receives multi-agent context, the prompt includes:

- the number of available browser agents and valid agent IDs;
- current URL/title plus the latest task outcome for every agent;
- the coordinator shared-state snapshot;
- merge conflicts from the previous wave;
- compact summaries of recent coordination waves;
- matching domain skills loaded from `skillsDir` or the default Talox skill search paths;
- explicit instructions to return independent parallel steps when useful.

Planner steps can assign work with `args.agentId`. Missing or invalid IDs fall back to deterministic round-robin assignment so malformed planner output cannot accidentally target a nonexistent agent.

```json
{
  "index": 0,
  "action": "Research vendor A",
  "tool": "navigate",
  "args": {
    "agentId": 0,
    "url": "https://vendor-a.example",
    "resultKey": "vendorA"
  },
  "reasoning": "Run independent research in parallel",
  "retryable": true
}
```

The coordinated runtime currently accepts these planner tools: `navigate`, `click`, `type`, `getState`, `screenshot`, and `wait`. Aliases such as `open`, `goto`, `fill`, `state`, and `waitForTimeout` are normalized before delegation.

Malformed planner step entries are ignored rather than crashing the run. Bootstrap, planning, and execution failures produce explicit fail-closed stop reasons such as `bootstrap-failed`, `planner-error`, and `execution-error`.

### CLI

The published `talox` binary routes `run` into coordinated mode whenever `--agents` is greater than one:

```bash
talox run "compare three CRM products" --agents 3 --max-iterations 6
```

Both `--agents 3` and `--agents=3` are supported. Single-agent `run` and all other commands continue through the existing CLI implementation. Coordinated runs honor `--model`, `--api-key`, `--base-url`, `--url`, `--strategy`, `--max-iterations`, and `--skills-dir`; environment fallbacks include `OPENAI_API_KEY` and `OPENAI_BASE_URL`.

### Coordination lifecycle

```text
Goal
  ↓
Observe all agents
  ↓
LLMPlanner
  ↓
Plan one parallel wave
  ↓
AgentCoordinator
  ├─ Agent 0 ─┐
  ├─ Agent 1 ─┼─ concurrent execution
  └─ Agent 2 ─┘
  ↓
Ordered results + fresh page states
  ↓
Shared-state merge + conflict report
  ↓
Replan with new evidence
  ↺
```

A final read-only planner verification happens after the last permitted execution wave. This prevents a false `max-waves` result when the final delegated action actually completed the goal.

## Verification

The browser integration suite contains a real two-agent coordination scenario. Two Chromium-backed Talox agents navigate to isolated pages, publish shared evidence, perform separate interactions, and then replan against both resulting page states until the goal is verified complete.

## Coordination pattern

For custom orchestration without `PlanDelegateObserveLoop`, a planner can use the coordinator directly in waves:

1. Read `sharedState` and split the current goal into independent tasks.
2. Run those tasks in parallel.
3. Inspect ordered results, conflicts, and final page states.
4. Update shared state with conclusions or constraints.
5. Re-plan the next wave.

The low-level coordinator remains available for custom planners while `PlanDelegateObserveLoop` provides the standard Talox v8.1 adaptive orchestration path.
