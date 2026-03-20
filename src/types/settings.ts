/**
 * @file settings.ts
 * @description TaloxSettings - the full settings surface, and DEFAULT_SETTINGS
 */

// ─── TaloxSettings ─────────────────────────────────────────────────────────────

export interface TaloxSettings {
  // Interaction fidelity
  mouseSpeed: number;            // 0.1 (slowest) – 3.0 (raw). Default: 0.7
  typingDelayMin: number;        // ms. Default: 100
  typingDelayMax: number;        // ms. Default: 300
  typoProbability: number;      // 0–1. Default: 0.03
  fidgetEnabled: boolean;        // micro-movements. Default: true
  humanStealth: number;          // 0 (off) – 1.0 (full). Default: 1.0

  // Stealth & protection
  stealthLevel: 'low' | 'medium' | 'high';  // Default: 'high'
  adaptiveStealthEnabled: boolean;           // self-healing. Default: true
  automaticThinkingEnabled: boolean;         // Default: true

  // Perception (always full in v2 — field kept for future use)
  perceptionDepth: 'full';

  // Browser — managed automatically, but overrideable
  headed: boolean;               // Default: false. Auto-switches on blocker escalation.
  autoHeadedEscalation: boolean; // Default: true. Agent auto-escalates to headed if stuck.

  // Debug (agent-controlled at runtime via setVerbosity())
  verbosity: 0 | 1 | 2 | 3;     // Default: 0

  // Human takeover
  humanTakeoverEnabled: boolean;    // Default: false
  humanTakeoverTimeoutMs: number;  // Default: 120000 (0 = wait forever)

  // Auto-thinking idle timeout
  idleTimeout: number;             // Default: 5000

  // Precision decay
  precisionDecay: number;          // Default: 0.1

  // Adaptive stealth
  adaptiveStealthSensitivity: number;  // Default: 0.5
  adaptiveStealthRadius: number;      // Default: 100
}

// ─── DEFAULT_SETTINGS ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: TaloxSettings = {
  mouseSpeed: 0.7,
  typingDelayMin: 100,
  typingDelayMax: 300,
  typoProbability: 0.03,
  fidgetEnabled: true,
  humanStealth: 1.0,
  stealthLevel: 'high',
  adaptiveStealthEnabled: true,
  automaticThinkingEnabled: true,
  perceptionDepth: 'full',
  headed: false,
  autoHeadedEscalation: true,
  verbosity: 0,
  humanTakeoverEnabled: false,
  humanTakeoverTimeoutMs: 120000,
  idleTimeout: 5000,
  precisionDecay: 0.1,
  adaptiveStealthSensitivity: 0.5,
  adaptiveStealthRadius: 100,
};
