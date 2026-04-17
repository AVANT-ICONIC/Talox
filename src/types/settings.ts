/**
 * @file settings.ts
 * @description TaloxSettings - the full settings surface, and DEFAULT_SETTINGS
 */

// ─── Legacy Mode Compatibility (v1 → v2) ───────────────────────────────────────

/**
 * @deprecated Legacy modes are deprecated in v2. Use `TaloxSettings` directly.
 * Kept for backwards compatibility - these map to the new agent-first control model.
 *
 * Deprecated aliases (map to 'smart'):
 * - 'stealth' — was alias for adaptive (max stealth)
 * - 'balanced' — was alias for adaptive (balanced settings)
 * - 'qa' — was alias for adaptive (full perception + debugging)
 */
export type LegacyTaloxMode =
	| "smart"
	| "debug"
	| "speed"
	| "observe"
	| "browse"
	| "adaptive"
	| "stealth"
	| "balanced"
	| "qa";

/**
 * All valid legacy mode values.
 * @deprecated Legacy modes are deprecated in v2.
 * 'stealth', 'balanced', 'qa' are deprecated aliases for 'smart'.
 */
export const LEGACY_MODE_VALUES: LegacyTaloxMode[] = [
	// NOSONAR — intentional deprecated compat
	"smart",
	"debug",
	"speed",
	"observe",
	"browse",
	"adaptive",
	"stealth",
	"balanced",
	"qa",
];

/**
 * Check if a value is a valid legacy mode.
 * @deprecated Legacy modes are deprecated in v2.
 * @param value - The value to check
 * @returns True if the value is a valid LegacyTaloxMode
 *
 * @example
 * ```typescript
 * import { isLegacyMode } from 'talox';
 *
 * if (isLegacyMode(userInput)) {
 *   // TypeScript now knows userInput is LegacyTaloxMode
 *   const settings = resolveLegacyMode(userInput);
 * }
 * ```
 */
export function isLegacyMode(value: unknown): value is LegacyTaloxMode {
	// NOSONAR — intentional deprecated compat
	return typeof value === "string" && LEGACY_MODE_VALUES.includes(value as LegacyTaloxMode); // NOSONAR
}

/**
 * Maps a legacy mode to the new agent-first settings.
 *
 * @deprecated Use `TaloxSettings` directly instead of modes.
 * @param mode - The legacy mode to convert
 * @returns Partial TaloxSettings that reflect the mode's intent
 *
 * Mapping design (exposes tradeoffs explicitly):
 * - 'smart': High stealth, full perception, adaptive behavior enabled. Best for general automation.
 * - 'adaptive': Same as 'smart' - emphasizes the self-healing nature.
 * - 'debug': Maximum verbosity, headed mode, human takeover enabled. For troubleshooting.
 * - 'speed': Low stealth, no fidget, fast mouse. Fastest but most detectable.
 * - 'browse': Headed mode with human takeover for interactive browsing.
 * - 'observe': Headed mode with full perception for observation sessions.
 *
 * Migration guide:
 * ```typescript
 * // v1 (legacy)
 * const talox = new TaloxController('./profiles', { mode: 'debug' });
 *
 * // v2 (explicit settings - recommended)
 * const talox = new TaloxController('./profiles', {
 *   settings: {
 *     verbosity: 3,
 *     headed: true,
 *     humanTakeoverEnabled: true
 *   }
 * });
 *
 * // v2 (backwards compatible - mode still works)
 * const talox = new TaloxController('./profiles', {
 *   mode: 'debug',              // Legacy mode maps to settings
 *   settings: { mouseSpeed: 1.5 } // Additional overrides
 * });
 *
 * // Inspect what a mode maps to
 * console.log(resolveLegacyMode('speed'));
 * // { mouseSpeed: 2, typingDelayMin: 20, ... }
 * ```
 */
export function resolveLegacyMode(mode: LegacyTaloxMode): Partial<TaloxSettings> {
	// NOSONAR — intentional deprecated compat
	switch (mode) {
		case "smart":
		case "adaptive":
		case "stealth":
		case "balanced":
		case "qa":
			// High stealth, adaptive behavior, full perception - the "works everywhere" default
			// Tradeoff: Uses bot-detection warmup delays and stealth randomness that may distort results.
			// For testing your own app, prefer explicit settings with debug mode.
			return {
				mouseSpeed: 0.7,
				stealthLevel: "high",
				adaptiveStealthEnabled: true,
				humanStealth: 1,
				fidgetEnabled: true,
				verbosity: 0,
			};

		case "debug":
			// Maximum visibility for troubleshooting - explicit tradeoff: slower, headed
			return {
				verbosity: 3,
				headed: true,
				humanTakeoverEnabled: true,
				humanTakeoverTimeoutMs: 0, // Wait forever - debugging shouldn't auto-resume
				stealthLevel: "low", // Less stealth = more visibility into issues
				mouseSpeed: 1, // Faster for debugging
			};

		case "speed":
			// Fastest execution - explicit tradeoff: more detectable
			return {
				mouseSpeed: 2,
				typingDelayMin: 20,
				typingDelayMax: 50,
				typoProbability: 0,
				fidgetEnabled: false,
				humanStealth: 0,
				stealthLevel: "low",
				adaptiveStealthEnabled: false,
				verbosity: 0,
			};

		case "browse":
			// Interactive browsing - headed with human control
			return {
				headed: true,
				humanTakeoverEnabled: true,
				humanTakeoverTimeoutMs: 0,
				mouseSpeed: 0.8,
				verbosity: 1,
			};

		case "observe":
			// Observation session - headed, full perception, medium verbosity
			return {
				headed: true,
				verbosity: 2,
				stealthLevel: "medium",
				mouseSpeed: 0.5, // Slower for careful observation
			};

		default: {
			// Exhaustive check - should never reach here
			const _exhaustive: never = mode;
			return {};
		}
	}
}

// ─── TaloxSettings ─────────────────────────────────────────────────────────────

export interface TaloxSettings {
	// Interaction fidelity
	mouseSpeed: number; // 0.1 (slowest) – 3 (raw). Default: 0.7
	typingDelayMin: number; // ms. Default: 100
	typingDelayMax: number; // ms. Default: 300
	typoProbability: number; // 0–1. Default: 0.03
	fidgetEnabled: boolean; // micro-movements. Default: true
	humanStealth: number; // 0 (off) – 1 (full). Default: 1

	// Stealth & protection
	stealthLevel: "low" | "medium" | "high"; // Default: 'high'
	adaptiveStealthEnabled: boolean; // self-healing. Default: true
	automaticThinkingEnabled: boolean; // Default: true

	// Perception (always full in v2 — field kept for future use)
	perceptionDepth: "full";

	// Browser — managed automatically, but overrideable
	headed: boolean; // Default: false. Auto-switches on blocker escalation.
	autoHeadedEscalation: boolean; // Default: true. Agent auto-escalates to headed if stuck.

	// Debug (agent-controlled at runtime via setVerbosity())
	verbosity: 0 | 1 | 2 | 3; // Default: 0

	// Human takeover
	humanTakeoverEnabled: boolean; // Default: false
	humanTakeoverTimeoutMs: number; // Default: 120000 (0 = wait forever)

	// Auto-thinking idle timeout
	idleTimeout: number; // Default: 5000

	// Precision decay
	precisionDecay: number; // Default: 0.1

	// Adaptive stealth
	adaptiveStealthSensitivity: number; // Default: 0.5
	adaptiveStealthRadius: number; // Default: 100

	/**
	 * Deterministic safe mode — disables all human simulation (no jitter, no delays,
	 * no typos, raw direct clicks). Use when testing your own application and you
	 * want fast, predictable, deterministic interactions. Opposite of biomechanical mode.
	 * @default false
	 */
	safeMode: boolean;

	/**
	 * Automatically handle browser dialogs (alert, confirm, prompt, beforeunload)
	 * so the session is never blocked by unexpected popups.
	 * @default true
	 */
	autoDialogHandling: boolean;

	/**
	 * Session idle timeout in milliseconds. When no interaction (navigate, click,
	 * type, scroll) occurs for this duration the session emits a `sessionIdle`
	 * event and closes gracefully unless human takeover is configured.
	 * @default 300000 (5 minutes)
	 */
	sessionIdleTimeoutMs: number;

	/**
	 * Enable CDP session management for cross-origin iframes.
	 * When true, Talox auto-creates dedicated CDP sessions for cross-origin
	 * frames so agents can execute DOM commands inside them.
	 * @default false
	 */
	enableCrossOriginIframes: boolean;
}

// ─── DEFAULT_SETTINGS ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: TaloxSettings = {
	mouseSpeed: 0.7,
	typingDelayMin: 100,
	typingDelayMax: 300,
	typoProbability: 0.03,
	fidgetEnabled: true,
	humanStealth: 1,
	stealthLevel: "high",
	adaptiveStealthEnabled: true,
	automaticThinkingEnabled: true,
	perceptionDepth: "full",
	headed: false,
	autoHeadedEscalation: true,
	verbosity: 0,
	humanTakeoverEnabled: false,
	humanTakeoverTimeoutMs: 120000,
	idleTimeout: 5000,
	precisionDecay: 0.1,
	adaptiveStealthSensitivity: 0.5,
	adaptiveStealthRadius: 100,
	safeMode: false,
	autoDialogHandling: true,
	sessionIdleTimeoutMs: 300000,
	enableCrossOriginIframes: false,
};
