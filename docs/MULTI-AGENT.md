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

## Coordination pattern

A planner can use the coordinator in waves:

1. Read `sharedState` and split the current goal into independent tasks.
2. Run those tasks in parallel.
3. Inspect ordered results, conflicts, and final page states.
4. Update shared state with conclusions or constraints.
5. Re-plan the next wave.

This is the foundation for the v8.1 Plan-Delegate-Observe loop: browser execution stays parallel, while planning and shared state remain deterministic and inspectable.
