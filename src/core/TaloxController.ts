/**
 * @file TaloxController.ts (legacy re-export shim)
 *
 * The TaloxController implementation has moved to:
 *   src/core/controller/TaloxController.ts
 *
 * This file is a backwards-compatibility shim so that any code that previously
 * imported directly from `./core/TaloxController` continues to work.
 * It will be removed in v2.0.
 *
 * @deprecated Import from the package root instead: `import { TaloxController } from 'talox'`
 */
export {
  TaloxController,
  type AttentionFrame,
  type MovementStyle,
  type TypingRhythm,
  type AccelerationCurve,
} from './controller/TaloxController.js';

export type { BehavioralDNA } from '../types/index.js';

// Re-export legacy types that controllers code depended on
export type {
  TaloxEventType,
  TaloxEvent,
} from '../types/events.js';
