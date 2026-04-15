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

// Re-export legacy types that controllers code depended on
export type {
	TaloxEvent,
	TaloxEventType,
} from "../types/events.js";

export type { BehavioralDNA } from "../types/index.js";
export {
	type AccelerationCurve,
	type AttentionFrame,
	type MovementStyle,
	TaloxController,
	type TypingRhythm,
} from "./controller/TaloxController.js";
