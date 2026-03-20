/**
 * @file strategies.ts
 * @description Named adaptation strategies for the self-healing loop.
 *
 * Each strategy is a named recipe that the `AdaptationEngine` applies when a
 * specific `AdaptationReason` is detected. Strategies patch `TaloxSettings`
 * and optionally trigger a named side effect.
 */

import type { TaloxSettings }    from '../../types/index.js';
import type { AdaptationReason } from '../../types/events.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Named side effects that `AdaptationEngine` handles after applying a strategy. */
export type AdaptationSideEffect =
  | 'rotate_user_agent'
  | 'enable_semantic_healing'
  | 'emit_captcha_event';

/** A named adaptation recipe. */
export interface AdaptationStrategy {
  /** Human-readable strategy identifier used in `AdaptedEvent.strategy`. */
  name: string;
  /** Short description for logging and telemetry. */
  description: string;
  /** Partial settings patch applied by `AdaptationEngine`. */
  settingsPatch: Partial<TaloxSettings>;
  /** Optional side effect the engine handles after patching settings. */
  sideEffect?: AdaptationSideEffect;
}

// ─── Strategy Registry ────────────────────────────────────────────────────────

/**
 * The complete strategy registry — one entry per `AdaptationReason`.
 *
 * Design principles:
 * - Strategies are additive: they nudge settings, not replace them
 * - Patches are minimal: only change what is necessary
 * - Side effects are explicit and handled in `AdaptationEngine`
 */
export const STRATEGIES: Record<AdaptationReason, AdaptationStrategy> = {

  bot_detection_soft: {
    name:        'stealth_nudge',
    description: 'Increase mouse jitter and typing variance to appear more human',
    settingsPatch: {
      mouseSpeed:      0.5,
      humanStealth:    0.95,
      typoProbability: 0.12,
    },
  },

  bot_detection_hard: {
    name:        'stealth_escalation',
    description: 'Full stealth escalation — maximum biomechanical simulation + UA rotation',
    settingsPatch: {
      mouseSpeed:               0.3,
      humanStealth:             1.0,
      stealthLevel:             'high',
      typingDelayMin:           150,
      typingDelayMax:           400,
      typoProbability:          0.15,
      adaptiveStealthEnabled:   true,
      automaticThinkingEnabled: true,
    },
    sideEffect: 'rotate_user_agent',
  },

  selector_miss: {
    name:        'semantic_fallback',
    description: 'Selector resolution failed — activate SemanticMapper self-healing on next action',
    settingsPatch: {},
    sideEffect: 'enable_semantic_healing',
  },

  page_timeout: {
    name:        'pace_reduction',
    description: 'Page response too slow — reduce action pace and increase idle tolerance',
    settingsPatch: {
      mouseSpeed:  0.6,
      idleTimeout: 8000,
    },
  },

  rate_limit: {
    name:        'backoff',
    description: 'HTTP 429 received — back off significantly before next action',
    settingsPatch: {
      mouseSpeed:  0.4,
      idleTimeout: 15000,
    },
  },

  captcha_detected: {
    name:        'captcha_pause',
    description: 'CAPTCHA detected — pause and notify agent (human or solver required)',
    settingsPatch: {
      automaticThinkingEnabled: false,
    },
    sideEffect: 'emit_captcha_event',
  },

  blocker_unresolvable_headless: {
    name:        'escalate_to_headed',
    description: 'Blocker cannot be resolved headlessly — escalate to headed mode',
    settingsPatch: {
      headed: true,
      autoHeadedEscalation: true,
    },
  },

  blocker_resolved: {
    name:        'de_escalate_to_headless',
    description: 'Blocker resolved — return to headless mode',
    settingsPatch: {
      headed: false,
    },
  },

};
