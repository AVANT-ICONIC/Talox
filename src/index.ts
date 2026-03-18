/**
 * @file index.ts
 * @description Public exports for the Talox package.
 *
 * All public APIs are re-exported from this file. Import paths from previous
 * versions continue to work — backwards compatibility is maintained.
 */

// ─── Core Controller (new location) ──────────────────────────────────────────
export { TaloxController }                       from './core/controller/TaloxController.js';
export type { AttentionFrame }                   from './core/controller/TaloxController.js';
export type { MovementStyle, TypingRhythm, AccelerationCurve } from './core/controller/ActionExecutor.js';

// ─── Observe Mode ─────────────────────────────────────────────────────────────
export { ObserveSession }                        from './core/observe/ObserveSession.js';
export { AnnotationBuffer }                      from './core/observe/AnnotationBuffer.js';
export { SessionReporter }                       from './core/observe/SessionReporter.js';

// ─── Smart Mode ───────────────────────────────────────────────────────────────
export { AdaptationEngine }                      from './core/smart/AdaptationEngine.js';
export { BotDetector }                           from './core/smart/BotDetector.js';
export { STRATEGIES }                            from './core/smart/strategies.js';

// ─── Core Modules ─────────────────────────────────────────────────────────────
export * from './core/BrowserManager.js';
export * from './core/ProfileVault.js';
export * from './core/PageStateCollector.js';
export * from './core/RulesEngine.js';
export * from './core/BugEngine.js';
export * from './core/HumanMouse.js';
export * from './core/PolicyEngine.js';
export * from './core/TaloxTools.js';

// ─── Types ────────────────────────────────────────────────────────────────────
export * from './types/index.js';
