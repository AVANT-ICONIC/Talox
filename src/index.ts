/**
 * @file index.ts
 * @description Public exports for the Talox package (v2.0).
 *
 * All public APIs are re-exported from this file.
 */

// ─── Core Modules ─────────────────────────────────────────────────────────────
export * from "./core/BrowserManager.js";
export * from "./core/BugEngine.js";
export type { ChallengeState, ChallengeType, DetectedChallenge } from "./core/ChallengeDetector.js";
export { ChallengeDetector } from "./core/ChallengeDetector.js";
export type {
	ChallengeOutcome,
	ChallengeResolverOptions,
	ResolutionAttempt,
	ResolutionStrategy,
} from "./core/ChallengeResolver.js";
export { ChallengeResolver } from "./core/ChallengeResolver.js";
export type { AccelerationCurve, MovementStyle, TypingRhythm } from "./core/controller/ActionExecutor.js";
export type { TakeoverReason, TakeoverState, TakeoverSummary } from "./core/controller/TakeoverBridge.js";
// ─── Takeover Bridge (v2) ───────────────────────────────────────────────────
export { TakeoverBridge } from "./core/controller/TakeoverBridge.js";
export type { AttentionFrame, DebugSnapshot } from "./core/controller/TaloxController.js";
// ─── Core Controller ────────────────────────────────────────────────────────────
export { TaloxController } from "./core/controller/TaloxController.js";
export * from "./core/HumanMouse.js";
export type { InteractionAttempt, InteractionFailureMode, ReliabilityOutcome } from "./core/InteractionReliability.js";
export { InteractionReliability } from "./core/InteractionReliability.js";
export { AnnotationBuffer } from "./core/observe/AnnotationBuffer.js";
// ─── Observe Mode ─────────────────────────────────────────────────────────────
export { ObserveSession } from "./core/observe/ObserveSession.js";
export { SessionReporter } from "./core/observe/SessionReporter.js";
export * from "./core/PageStateCollector.js";
export type {
	PerceivedState,
	PerceptionCollectOptions,
	PerceptionLayerFlags,
	PerceptionPreset,
} from "./core/PerceptionStack.js";
export { PERCEPTION_PRESETS, PerceptionStack } from "./core/PerceptionStack.js";
export * from "./core/PolicyEngine.js";
export * from "./core/ProfileVault.js";
export * from "./core/RulesEngine.js";
export type { SessionSnapshot } from "./core/SessionSnapshot.js";
export { captureSessionSnapshot, restoreSessionSnapshot } from "./core/SessionSnapshot.js";
// ─── Smart Mode (now always-on) ──────────────────────────────────────────────
export { AdaptationEngine } from "./core/smart/AdaptationEngine.js";
export { BotDetector } from "./core/smart/BotDetector.js";
export type { DomainMemorySnapshot, DomainRecord, StrategyScore } from "./core/smart/DomainMemory.js";
export { DomainMemory } from "./core/smart/DomainMemory.js";
export { STRATEGIES } from "./core/smart/strategies.js";
export * from "./core/TaloxTools.js";
export { PRESETS, type PresetName } from "./presets.js";
export { getPracticalTools } from "./tools/practical-tools.js";

// ─── v2 Config & Settings ────────────────────────────────────────────────────
export type { TaloxConfig } from "./types/config.js";
// ─── Types (v2) ──────────────────────────────────────────────────────────────
// TALOX_STATE_CONTRACT_VERSION, TaloxStateDiff, TaloxStateTiming, diffPageState
// and all core types are exported via the wildcard below.
export * from "./types/index.js";
// ─── Legacy Mode Compatibility (v1 → v2) ─────────────────────────────────────
/**
 * @deprecated Legacy modes are deprecated in v2. Use `TaloxSettings` directly.
 * These exports provide backwards compatibility for code using the old mode system.
 *
 * Migration guide:
 * - `mode: 'smart'` → Use `DEFAULT_SETTINGS` (smart is now the default)
 * - `mode: 'debug'` → `{ verbosity: 3, headed: true, humanTakeoverEnabled: true }`
 * - `mode: 'speed'` → `{ mouseSpeed: 2.0, fidgetEnabled: false, stealthLevel: 'low' }`
 * - `mode: 'observe'` → `{ headed: true, verbosity: 2 }`
 * - `mode: 'browse'` → `{ headed: true, humanTakeoverEnabled: true }`
 * - `mode: 'adaptive'` → Same as 'smart'
 *
 * Helper functions for migration:
 * - `resolveLegacyMode(mode)` - Get settings for a legacy mode
 * - `isLegacyMode(value)` - Type guard to check if value is a valid legacy mode
 * - `LEGACY_MODE_VALUES` - Array of all valid legacy mode strings
 *
 * @example
 * ```typescript
 * import { resolveLegacyMode, isLegacyMode, LEGACY_MODE_VALUES } from 'talox';
 *
 * // Check if a string is a valid legacy mode
 * if (isLegacyMode(userInput)) {
 *   const settings = resolveLegacyMode(userInput);
 * }
 *
 * // See all valid modes
 * console.log(LEGACY_MODE_VALUES); // ['smart', 'debug', 'speed', ...]
 * ```
 */
export type { LegacyTaloxMode, TaloxSettings } from "./types/settings.js";
export { DEFAULT_SETTINGS, isLegacyMode, LEGACY_MODE_VALUES, resolveLegacyMode } from "./types/settings.js";
