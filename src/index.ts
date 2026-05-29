/**
 * @file index.ts
 * @description Public exports for the Talox package (v4.0).
 *
 * All public APIs are re-exported from this file.
 */

// ─── Multi-Agent Coordinator ───────────────────────────────────────────────
export {
	AgentCoordinator,
	type AgentResult,
	type AgentStatus,
	type AgentTask,
	type CoordinatorConfig,
	type CoordinatorResult,
} from "./core/AgentCoordinator.js";
// ─── Auto-Dialog Handling ──────────────────────────────────────────────────────
export type { DialogRecord } from "./core/AutoDialogHandler.js";
export { AutoDialogHandler } from "./core/AutoDialogHandler.js";
// ─── Core Modules ─────────────────────────────────────────────────────────────
export { BrowserManager, type BrowserType } from "./core/BrowserManager.js";
export * from "./core/BugEngine.js";
// ─── CAPTCHA Solver ────────────────────────────────────────────────────────
export {
	type CaptchaChallenge,
	type CaptchaSolution,
	type CaptchaSolver,
	type CaptchaVariant,
	clearSolvers,
	createVLMCaptchaSolver,
	getSolvers,
	registerSolver,
	trySolve,
} from "./core/CaptchaSolver.js";
export type { ChallengeState, ChallengeType, DetectedChallenge } from "./core/ChallengeDetector.js";
export { ChallengeDetector } from "./core/ChallengeDetector.js";
export type {
	ChallengeOutcome,
	ChallengeResolverOptions,
	ResolutionAttempt,
	ResolutionStrategy,
} from "./core/ChallengeResolver.js";
export { ChallengeResolver } from "./core/ChallengeResolver.js";
// ─── Cross-Origin iframe Sessions ────────────────────────────────────────────
export type { IframeSession } from "./core/CrossOriginManager.js";
export { CrossOriginManager } from "./core/CrossOriginManager.js";
// ─── Chat Mode ────────────────────────────────────────────────────────────────
export type { ChatConfig } from "./core/chat/ChatSession.js";
export { ChatSession } from "./core/chat/ChatSession.js";
export type { AccelerationCurve, MovementStyle, TypingRhythm } from "./core/controller/ActionExecutor.js";
export { EventBus } from "./core/controller/EventBus.js";
export type { TakeoverReason, TakeoverState, TakeoverSummary } from "./core/controller/TakeoverBridge.js";
// ─── Takeover Bridge (v2) ───────────────────────────────────────────────────
export { TakeoverBridge } from "./core/controller/TakeoverBridge.js";
export type { AttentionFrame, DebugSnapshot } from "./core/controller/TaloxController.js";
// ─── Core Controller ────────────────────────────────────────────────────────────
export { TaloxController } from "./core/controller/TaloxController.js";
// ─── Daemon / IPC ──────────────────────────────────────────────────────────────
export type { DaemonCommand, DaemonConfig, DaemonResponse } from "./core/daemon/TaloxDaemon.js";
export { TaloxDaemon } from "./core/daemon/TaloxDaemon.js";
export * from "./core/FingerprintGenerator.js";
// ─── HAR Recording ──────────────────────────────────────────────────────────
export type {
	HarEntry,
	HarFile,
	HarHeader,
	HarLog,
	HarRecorderOptions,
	HarRequest,
	HarResponse,
	HarResult,
	HarTiming,
} from "./core/HarRecorder.js";
export { HarRecorder } from "./core/HarRecorder.js";
export * from "./core/HumanMouse.js";
// ─── Interaction Quality ──────────────────────────────────────────────────
export {
	type ClickMetrics,
	computeQuality,
	type MouseMetrics,
	type QualityDimensions,
	type QualityScore,
	QualityTracker,
	type ScrollMetrics,
	scoreClick,
	scoreInteraction,
	scoreMouse,
	scoreScroll,
	scoreTyping,
	type TypingMetrics,
} from "./core/InteractionQuality.js";
export type { InteractionAttempt, InteractionFailureMode, ReliabilityOutcome } from "./core/InteractionReliability.js";
export { InteractionReliability } from "./core/InteractionReliability.js";
// ─── DevTools Inspect Server ────────────────────────────────────────────────
export type { InspectServerConfig } from "./core/inspect/InspectServer.js";
export { InspectServer } from "./core/inspect/InspectServer.js";
export { createLogger, getLogLevel, type Logger, type LogLevel, log, setLogLevel } from "./core/Logger.js";
// ─── Autonomous Loop (v6) ───────────────────────────────────────────────────
export { AutonomousLoop } from "./core/loop/AutonomousLoop.js";
export type { Planner } from "./core/loop/Planner.js";
export { LLMPlanner } from "./core/loop/Planner.js";
export type * from "./core/loop/types.js";
// ─── Origin-Scoped Headers ────────────────────────────────────────────────────
export type { OriginHeaderConfig } from "./core/OriginHeaders.js";
export { OriginHeaders } from "./core/OriginHeaders.js";
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
export { AdaptiveExperimentPriority } from "./core/research/AdaptiveExperimentPriority.js";
// ─── Auto-Research Loop (v7) ───────────────────────────────────────────────
export { AutoResearchLoop, DEFAULT_RESEARCH_CONFIG } from "./core/research/AutoResearchLoop.js";
export { CrossDomainTransfer } from "./core/research/CrossDomainTransfer.js";
export { ExperimentRunner } from "./core/research/ExperimentRunner.js";
export { HypothesisGenerator } from "./core/research/HypothesisGenerator.js";
export { PromptEvolver } from "./core/research/PromptEvolver.js";
export { RegressionHarness } from "./core/research/RegressionHarness.js";
export { ResearchJournal } from "./core/research/ResearchJournal.js";
export { ResearchReporter } from "./core/research/ResearchReporter.js";
export { SkillEvaluator } from "./core/research/SkillEvaluator.js";
export { SkillVersioning } from "./core/research/SkillVersioning.js";
export { StrategyComposer } from "./core/research/StrategyComposer.js";
export type * from "./core/research/types.js";
export type { SessionSnapshot } from "./core/SessionSnapshot.js";
export { captureSessionSnapshot, restoreSessionSnapshot } from "./core/SessionSnapshot.js";
// ─── Site Warmup ──────────────────────────────────────────────────────────────
export type { WarmupStrategy } from "./core/SiteWarmup.js";
export { BUILT_IN_WARMUPS, SiteWarmupRegistry } from "./core/SiteWarmup.js";
export type { LoadedSkill, SkillManifest } from "./core/skills/SkillLoader.js";
// ─── Skills / Domain Knowledge ──────────────────────────────────────────────
export { SkillLoader } from "./core/skills/SkillLoader.js";
export { SkillWriter } from "./core/skills/SkillWriter.js";
export type { AdaptationRecord } from "./core/smart/AdaptationEngine.js";
// ─── Smart Mode (now always-on) ──────────────────────────────────────────────
export { AdaptationEngine } from "./core/smart/AdaptationEngine.js";
export { BotDetector } from "./core/smart/BotDetector.js";
export type { DomainMemorySnapshot, DomainRecord, StrategyScore } from "./core/smart/DomainMemory.js";
export { DomainMemory } from "./core/smart/DomainMemory.js";
export { STRATEGIES } from "./core/smart/strategies.js";
export * from "./core/TaloxTools.js";
// ─── Video Recording ────────────────────────────────────────────────────────
export type { VideoFormat, VideoRecorderOptions } from "./core/VideoRecorder.js";
export { VideoRecorder } from "./core/VideoRecorder.js";
export {
	askVisual,
	createOpenAIVisionReasoner,
	getScreenshotFormat,
	getVisualReasoner,
	type OpenAIVisionConfig,
	resolveVisual,
	type ScreenshotFormat,
	setScreenshotFormat,
	setVisualReasoner,
	type VisualReasoner,
} from "./core/VisualReasoner.js";
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
