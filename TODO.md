# Talox v6.0 — Autonomous Loop & Dynamic Skill Creation

## Phase 1: Types & Interfaces
- [ ] Task 1: Create loop type definitions (`src/core/loop/types.ts` + tests)

## Phase 2: Planner Interface
- [ ] Task 2: Create Planner interface and LLM implementation (`src/core/loop/Planner.ts` + tests)

## Phase 3: SkillWriter
- [ ] Task 3: Extend SkillLoader with write capabilities (`src/core/skills/SkillWriter.ts` + tests)

## Phase 4: AutonomousLoop Core
- [ ] Task 4: Create the AutonomousLoop orchestrator (`src/core/loop/AutonomousLoop.ts` + tests)

## Phase 5: Integration
- [ ] Task 5: Expose resolveChallenge on TaloxController
- [ ] Task 6: Add loop events to TaloxEventMap
- [ ] Task 7: Export everything from index.ts

## Phase 6: CLI & DX
- [ ] Task 8: Add `talox run` CLI command
- [ ] Task 9: Add `talox skill create` CLI command

## Phase 7: Loop Intelligence
- [ ] Task 10: Implement blocker → skill auto-generation
- [ ] Task 11: Implement convergence/stuck-loop detection

## Phase 8: Ship
- [ ] Task 12: Update AGENTS.md with v6.0 architecture
- [ ] Task 13: Update CHANGELOG.md
- [ ] Task 14: Bump version, full test suite, SonarQube scan
- [ ] Task 15: Create GitHub release
