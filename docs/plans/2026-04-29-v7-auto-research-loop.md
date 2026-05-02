# v7.0.0 — AutoResearchLoop Implementation Plan

> **Status:** ✅ COMPLETE (2026-05-02)

**Goal:** Karpathy-style self-research loop where Talox autonomously hypothesizes, experiments, measures, and rewrites its own browser interaction strategies.

**Architecture:** `AutoResearchLoop` wraps the existing `AutonomousLoop`. 11 subsystems under `src/core/research/` plug into existing `DomainMemory`, `AdaptationEngine`, `SkillWriter`, and `Planner` without rewriting them.

---

## Implemented Subsystems

| # | Subsystem | File | Description |
|---|-----------|------|-------------|
| 1 | ResearchJournal | `ResearchJournal.ts` | Append-only event log with domain summaries, persistence, query API |
| 2 | HypothesisGenerator | `HypothesisGenerator.ts` | Generates A/B test hypotheses from domain history + planner |
| 3 | ExperimentRunner | `ExperimentRunner.ts` | A/B test orchestration, arm execution, statistical comparison |
| 4 | SkillEvaluator | `SkillEvaluator.ts` | Weighted scoring (iterations/duration/cost/success), keep/prune verdicts |
| 5 | CrossDomainTransfer | `CrossDomainTransfer.ts` | Jaccard similarity on blocker types + strategies for cross-domain strategy transfer |
| 6 | PromptEvolver | `PromptEvolver.ts` | Genetic prompt optimization with population-based evolution + fitness scoring |
| 7 | SkillVersioning | `SkillVersioning.ts` | Git-like version tracking (v1, v2, ...), rollback to best, max version cap |
| 8 | RegressionHarness | `RegressionHarness.ts` | Wall-clock performance regression detection with configurable thresholds |
| 9 | ResearchReporter | `ResearchReporter.ts` | Markdown/JSON/HTML report generation from journal history |
| 10 | AdaptiveExperimentPriority | `AdaptiveExperimentPriority.ts` | Thompson sampling (Beta distribution) for experiment arm prioritization |
| 11 | StrategyComposer | `StrategyComposer.ts` | Discovers composed (combined) strategies from historical success patterns |

## Supporting Files

- `types.ts` — shared type contracts (Hypothesis, ExperimentRun, RunMetrics, etc.)
- `index.ts` — barrel export

## Test Coverage

- **12 test files** in `tests/unit/research/`
- **136 tests** — all passing
- Full suite: **1,554 tests / 79 files** — zero failures

## Usage

```ts
import { AutoResearchLoop } from 'talox';

const loop = new AutoResearchLoop(loopFactory, {
  config: {
    persistToDisk: true,
    researchDir: '.talox/research',
    enableCrossDomainTransfer: true,
    enablePromptEvolution: true,
  },
  planner: myPlanner, // optional
});

await loop.initialize();
const result = await loop.run(
  { description: 'navigate to login page', maxIterations: 10 },
  'example.com',
);

// Generate a research report
const report = loop.generateReport({ from: '2026-01-01', to: '2026-12-31' });
```

## Flow

1. Load journal + history
2. Generate hypotheses (HypothesisGenerator)
3. Optionally transfer strategies from similar domains (CrossDomainTransfer)
4. Optionally evolve prompts (PromptEvolver)
5. Run experiments (ExperimentRunner)
6. Evaluate skills (SkillEvaluator)
7. Promote winning strategies
8. Discover composed strategies (StrategyComposer)
9. Run regression tests (RegressionHarness)
10. Generate report (ResearchReporter)
11. Persist journal
