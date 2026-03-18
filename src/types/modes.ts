/**
 * @file modes.ts
 * @description Canonical execution mode types for TaloxController.
 *
 * Talox operates in four first-class modes. All legacy mode strings from v1.x
 * are accepted at runtime but emit a deprecation warning and map to 'smart'.
 */

// ─── Canonical Modes ─────────────────────────────────────────────────────────

/**
 * The four canonical execution modes.
 *
 * | Mode      | Who uses it          | What it does                                         |
 * |-----------|----------------------|------------------------------------------------------|
 * | `smart`   | Production agents    | Self-healing, outcome-aware, full human simulation   |
 * | `speed`   | CI / bulk tasks      | Raw Playwright, zero simulation, max throughput      |
 * | `debug`   | Diagnosing failures  | Static settings, verbose events, fully reproducible  |
 * | `observe` | Human test runs      | Human drives, agent watches, session report on close |
 */
export type TaloxMode = 'smart' | 'speed' | 'debug' | 'observe';

// ─── Deprecated Aliases (v1.x → removed in v2.0) ────────────────────────────

/**
 * Legacy mode strings accepted for backwards compatibility.
 * All map to `'smart'` at runtime with a `console.warn` migration hint.
 *
 * @deprecated Use {@link TaloxMode} values instead. Will be removed in v2.0.
 */
export type DeprecatedTaloxMode =
  | 'adaptive'
  | 'stealth'
  | 'balanced'
  | 'browse'
  | 'qa'
  | 'hybrid';

/**
 * Union of all accepted mode strings (canonical + deprecated).
 * Use this as the parameter type when accepting user input.
 */
export type AnyTaloxMode = TaloxMode | DeprecatedTaloxMode;

// ─── Runtime Helpers ─────────────────────────────────────────────────────────

/** Set of all canonical (non-deprecated) mode strings. */
export const CANONICAL_MODES = new Set<TaloxMode>(['smart', 'speed', 'debug', 'observe']);

/** Map of deprecated mode strings → canonical replacements. */
export const DEPRECATED_MODE_MAP: Record<DeprecatedTaloxMode, TaloxMode> = {
  adaptive: 'smart',
  stealth:  'smart',
  balanced: 'smart',
  browse:   'smart',
  qa:       'smart',
  hybrid:   'smart',
};

/**
 * Resolves any mode string (canonical or deprecated) to a canonical TaloxMode.
 * Emits a `console.warn` for deprecated inputs.
 */
export function resolveMode(input: AnyTalaxMode | string): TaloxMode {
  if (CANONICAL_MODES.has(input as TaloxMode)) {
    return input as TaloxMode;
  }

  const mapped = DEPRECATED_MODE_MAP[input as DeprecatedTaloxMode];
  if (mapped) {
    console.warn(
      `[Talox] Mode '${input}' is deprecated and will be removed in v2.0. ` +
      `Use '${mapped}' instead. See https://talox.dev/migration/modes`,
    );
    return mapped;
  }

  console.warn(`[Talox] Unknown mode '${input}', falling back to 'smart'.`);
  return 'smart';
}

// Alias for external consumers who may use the old spelling
type AnyTalaxMode = AnyTaloxMode;
