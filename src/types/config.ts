/**
 * @file config.ts
 * @description TaloxConfig - what you pass to TaloxController constructor
 */

import type { OriginHeaderConfig } from "../core/OriginHeaders.js";
import type { InspectServerConfig } from "../core/inspect/InspectServer.js";
import type { LegacyTaloxMode, TaloxSettings } from "./settings.js"; // NOSONAR

export interface TaloxConfig {
	profile?: string; // session profile name (default: 'default')
	observe?: boolean; // human drives, agent watches (default: false)
	settings?: Partial<TaloxSettings>; // override any default setting
	humanTakeover?:
		| boolean
		| {
				timeoutMs?: number; // 0 = wait forever (default: 120000 = 2min)
		  };
	/** Per-origin HTTP headers to inject into matching requests. */
	originHeaders?: OriginHeaderConfig;
	/**
	 * Enable HAR 1.2 network recording for the session.
	 * When enabled, all requests and responses are captured and flushed to
	 * `outputPath` when `stop()` is called.
	 */
	harRecording?: {
		enabled: boolean;
		outputPath: string;
		includeContent?: boolean;
	};
	/**
	 * Enable Chrome DevTools inspect server for remote debugging.
	 * When configured, a WebSocket proxy exposes the page to DevTools.
	 */
	inspectServer?: InspectServerConfig;
	/**
	 * Enable video recording for the session.
	 * When enabled, frames are captured at the given FPS and encoded on `stop()`.
	 */
	videoRecording?: {
		enabled: boolean;
		outputPath: string;
		fps?: number;
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
	mode?: LegacyTaloxMode; // NOSONAR
}
