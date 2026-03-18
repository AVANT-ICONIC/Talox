/**
 * @file AdaptationEngine.ts
 * @description Smart mode outcome-feedback loop.
 *
 * `AdaptationEngine` is called after every interaction in `smart` mode.
 * It delegates detection to `BotDetector`, selects the appropriate strategy
 * from the registry, applies the settings patch via `ModeManager`, fires the
 * `adapted` event, and handles any required side effects.
 *
 * This class is the only place in the codebase that emits `'adapted'` events.
 */

import type { TaloxPageState }         from '../../types/index.js';
import type { TaloxEventMap }          from '../../types/events.js';
import type { EventBus }               from '../controller/EventBus.js';
import type { ModeManager }            from '../controller/ModeManager.js';
import { BotDetector }                 from './BotDetector.js';
import { STRATEGIES, type AdaptationSideEffect } from './strategies.js';

// ─── AdaptationEngine ────────────────────────────────────────────────────────

/**
 * Runs the smart-mode outcome feedback loop after every agent interaction.
 *
 * Flow:
 * ```
 * interaction completes
 *   → evaluate(state) called
 *   → BotDetector.detect(state) → reason | null
 *   → if reason: select strategy, patch settings, emit 'adapted'
 *   → handle side effects (UA rotation, etc.)
 * ```
 */
export class AdaptationEngine {
  private readonly detector:    BotDetector;
  private readonly modeManager: ModeManager;
  private readonly eventBus:    EventBus<TaloxEventMap>;

  /** Tracks whether semantic self-healing is currently forced on. */
  private semanticHealingActive: boolean = false;

  /** Rotating index for user-agent selection. */
  private uaIndex: number = 0;

  private readonly userAgents: readonly string[] = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ] as const;

  constructor(
    modeManager: ModeManager,
    eventBus:    EventBus<TaloxEventMap>,
  ) {
    this.detector    = new BotDetector();
    this.modeManager = modeManager;
    this.eventBus    = eventBus;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Evaluate a page state after an interaction.
   * If a bot-detection signal is found, applies the matching strategy and
   * emits the `adapted` event. No-op if the page appears clean.
   *
   * @param state - The `TaloxPageState` returned by the last interaction.
   */
  async evaluate(state: TaloxPageState): Promise<void> {
    // Only active in smart mode
    if (!this.modeManager.shouldEmitAdapted()) return;

    const reason = this.detector.detect(state);
    if (!reason) return;

    const strategy = STRATEGIES[reason];
    if (!strategy) return;

    // Snapshot settings before patching
    const before = this.modeManager.getSettings();

    // Apply the settings patch
    this.modeManager.updateSettings(strategy.settingsPatch);

    // Snapshot settings after patching
    const after = this.modeManager.getSettings();

    // Emit the typed adapted event — agent gets full transparency
    this.eventBus.emit('adapted', {
      reason,
      strategy: strategy.name,
      from: before,
      to:   after,
    });

    console.info(
      `[Talox Smart] Adapted: ${strategy.name} (${strategy.description})`,
    );

    // Handle side effects
    if (strategy.sideEffect) {
      await this.handleSideEffect(strategy.sideEffect);
    }
  }

  /**
   * Returns `true` if semantic self-healing has been activated by a
   * `selector_miss` adaptation. The `ActionExecutor` checks this flag
   * before attempting direct selector resolution.
   */
  isSemanticHealingActive(): boolean {
    return this.semanticHealingActive;
  }

  /**
   * Reset semantic healing flag after it has been used.
   * Called by `ActionExecutor` after a successful self-healed interaction.
   */
  resetSemanticHealing(): void {
    this.semanticHealingActive = false;
  }

  /**
   * Returns the next user agent string in the rotation.
   * Called during `rotate_user_agent` side effect handling.
   */
  getNextUserAgent(): string {
    const ua = this.userAgents[this.uaIndex % this.userAgents.length];
    this.uaIndex++;
    return ua ?? this.userAgents[0]!;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async handleSideEffect(effect: AdaptationSideEffect): Promise<void> {
    switch (effect) {

      case 'rotate_user_agent':
        // Logged here; actual UA rotation requires browser restart which is
        // outside the engine's scope. The agent receives the adapted event
        // and can call talox.stop() + talox.launch() with the new UA if needed.
        console.info(
          `[Talox Smart] UA rotation suggested. Next agent: ${this.getNextUserAgent()}`,
        );
        break;

      case 'enable_semantic_healing':
        this.semanticHealingActive = true;
        console.info('[Talox Smart] Semantic self-healing activated for next action.');
        break;

      case 'emit_captcha_event':
        // CAPTCHA events surface as adapted events with reason 'captcha_detected'.
        // The agent is responsible for solving or surfacing to the user.
        console.warn('[Talox Smart] CAPTCHA detected — human intervention or solver required.');
        break;
    }
  }
}
