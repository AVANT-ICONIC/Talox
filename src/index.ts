/**
 * @file index.ts
 * @description Public exports for the Talox package (v2.0).
 *
 * All public APIs are re-exported from this file.
 */

// ─── Core Controller ────────────────────────────────────────────────────────────
export { TaloxController } from './core/controller/TaloxController.js';
export type { AttentionFrame } from './core/controller/TaloxController.js';
export type { MovementStyle, TypingRhythm, AccelerationCurve } from './core/controller/ActionExecutor.js';

// ─── Takeover Bridge (v2) ───────────────────────────────────────────────────
export { TakeoverBridge } from './core/controller/TakeoverBridge.js';
export type { TakeoverState } from './core/controller/TakeoverBridge.js';

// ─── Observe Mode ─────────────────────────────────────────────────────────────
export { ObserveSession } from './core/observe/ObserveSession.js';
export { AnnotationBuffer } from './core/observe/AnnotationBuffer.js';
export { SessionReporter } from './core/observe/SessionReporter.js';

// ─── Smart Mode (now always-on) ──────────────────────────────────────────────
export { AdaptationEngine } from './core/smart/AdaptationEngine.js';
export { BotDetector } from './core/smart/BotDetector.js';
export { STRATEGIES } from './core/smart/strategies.js';

// ─── Core Modules ─────────────────────────────────────────────────────────────
export * from './core/BrowserManager.js';
export * from './core/ProfileVault.js';
export * from './core/PageStateCollector.js';
export * from './core/RulesEngine.js';
export * from './core/BugEngine.js';
export * from './core/HumanMouse.js';
export * from './core/PolicyEngine.js';
export * from './core/TaloxTools.js';

// ─── Types (v2) ──────────────────────────────────────────────────────────────
export * from './types/index.js';

// ─── v2 Config & Settings ────────────────────────────────────────────────────
export type { TaloxConfig } from './types/config.js';
export type { TaloxSettings } from './types/settings.js';
export { DEFAULT_SETTINGS } from './types/settings.js';
export type { DebugSnapshot } from './core/controller/TaloxController.js';