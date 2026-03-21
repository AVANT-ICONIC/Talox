/**
 * @file config.ts
 * @description TaloxConfig - what you pass to TaloxController constructor
 */

import type { TaloxSettings, LegacyTaloxMode } from './settings.js';

export interface TaloxConfig {
  profile?: string;                    // session profile name (default: 'default')
  observe?: boolean;                   // human drives, agent watches (default: false)
  settings?: Partial<TaloxSettings>;   // override any default setting
  humanTakeover?: boolean | {
    timeoutMs?: number;                // 0 = wait forever (default: 120000 = 2min)
  };
  /**
   * @deprecated Use `settings` instead. Legacy modes map to the new agent-first control model.
   * - 'smart' | 'adaptive' | 'stealth' | 'balanced' | 'qa' → DEFAULT_SETTINGS (high stealth, adaptive behavior)
   *   Note: 'stealth', 'balanced', 'qa' are deprecated aliases for 'smart'/'adaptive'.
   * - 'debug' → headed, verbosity 3, human takeover enabled
   * - 'speed' → fast mouse, low stealth, no fidget
   * - 'browse' → headed with human takeover for interactive browsing
   * - 'observe' → headed with full perception for observation
   * 
   * Use `resolveLegacyMode()` to see the exact mapping.
   */
  mode?: LegacyTaloxMode;
}
