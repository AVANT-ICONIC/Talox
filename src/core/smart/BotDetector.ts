/**
 * @file BotDetector.ts
 * @description Detects bot-detection signals in page state for smart mode.
 *
 * `BotDetector` examines a `TaloxPageState` and returns the most critical
 * `AdaptationReason` if a detection signal is found, or `null` if the page
 * appears clean. It is called by `AdaptationEngine` after every interaction.
 *
 * Detection signals (in priority order):
 * 1. CAPTCHA / challenge wall (title, URL, body text)
 * 2. Hard block redirect (/blocked, /challenge, /denied, /sorry)
 * 3. HTTP 429 rate limit in network failures
 * 4. Fingerprinting libraries in loaded scripts
 * 5. Soft bot signals (Cloudflare JS challenge, suspicious redirects)
 */

import type { TaloxPageState }   from '../../types/index.js';
import type { AdaptationReason } from '../../types/events.js';

// ─── Detection Patterns ───────────────────────────────────────────────────────

/** Patterns that indicate a CAPTCHA or hard challenge wall. */
const CAPTCHA_TITLE_PATTERNS = [
  /captcha/i,
  /verify you are human/i,
  /just a moment/i,        // Cloudflare interstitial
  /please verify/i,
  /security check/i,
  /bot check/i,
  /human verification/i,
];

const CAPTCHA_URL_PATTERNS = [
  /\/challenge/i,
  /\/captcha/i,
  /\/verify/i,
  /hcaptcha\.com/i,
  /recaptcha\.net/i,
  /recaptcha\.google\.com/i,
];

/** Patterns that indicate a hard block (access denied). */
const HARD_BLOCK_URL_PATTERNS = [
  /\/blocked/i,
  /\/denied/i,
  /\/sorry/i,
  /\/access-denied/i,
  /\/403/i,
];

/** Patterns that indicate fingerprinting libraries are present. */
const FINGERPRINT_SCRIPT_PATTERNS = [
  /fingerprintjs/i,
  /creepjs/i,
  /fp2\./i,
  /botd\./i,
  /datadome/i,
  /imperva/i,
  /perimeterx/i,
];

/** Patterns that indicate soft bot detection (JS challenges, etc.). */
const SOFT_BOT_SIGNALS = [
  /cf-browser-verification/i,    // Cloudflare
  /challenge-platform/i,
  /cf_chl_opt/i,
];

// ─── BotDetector ─────────────────────────────────────────────────────────────

/**
 * Stateless utility that scans a `TaloxPageState` for bot-detection signals
 * and returns the most appropriate `AdaptationReason`.
 */
export class BotDetector {

  /**
   * Scan a page state for bot-detection signals.
   *
   * @returns The most critical `AdaptationReason` found, or `null` if clean.
   */
  detect(state: TaloxPageState): AdaptationReason | null {
    // Priority 1: CAPTCHA / hard challenge wall
    if (this.isCaptchaDetected(state)) {
      return 'captcha_detected';
    }

    // Priority 2: Hard block redirect
    if (this.isHardBlock(state)) {
      return 'bot_detection_hard';
    }

    // Priority 3: Rate limiting
    if (this.isRateLimited(state)) {
      return 'rate_limit';
    }

    // Priority 4: Fingerprinting scripts loaded
    if (this.hasFingerprintingScripts(state)) {
      return 'bot_detection_soft';
    }

    // Priority 5: Soft bot signals in page
    if (this.hasSoftBotSignals(state)) {
      return 'bot_detection_soft';
    }

    return null;
  }

  // ─── Private Detectors ───────────────────────────────────────────────────────

  private isCaptchaDetected(state: TaloxPageState): boolean {
    // Check title
    if (CAPTCHA_TITLE_PATTERNS.some(p => p.test(state.title))) return true;

    // Check URL
    if (CAPTCHA_URL_PATTERNS.some(p => p.test(state.url))) return true;

    // Check page text via console logs / node names (lightweight heuristic)
    const textSignals = [
      ...state.console.logs ?? [],
      ...state.nodes.map(n => n.name ?? ''),
    ].join(' ');

    if (CAPTCHA_TITLE_PATTERNS.some(p => p.test(textSignals))) return true;

    return false;
  }

  private isHardBlock(state: TaloxPageState): boolean {
    return HARD_BLOCK_URL_PATTERNS.some(p => p.test(state.url));
  }

  private isRateLimited(state: TaloxPageState): boolean {
    return state.network.failedRequests.some(r => r.status === 429);
  }

  private hasFingerprintingScripts(state: TaloxPageState): boolean {
    const networkUrls = [
      ...state.network.failedRequests.map(r => r.url),
      ...(state.network.exceptions ?? []).map((e: any) => e?.url ?? ''),
    ].join(' ');

    return FINGERPRINT_SCRIPT_PATTERNS.some(p => p.test(networkUrls));
  }

  private hasSoftBotSignals(state: TaloxPageState): boolean {
    const pageText = state.nodes.map(n => n.name ?? '').join(' ');
    return SOFT_BOT_SIGNALS.some(p => p.test(pageText));
  }
}
