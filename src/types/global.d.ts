/**
 * Global window / navigator extensions injected by Talox at runtime.
 *
 * These augmentations mean callers NEVER need `as any` casts to access
 * Talox-injected properties on `window`, `globalThis`, or `navigator`.
 */

export {};

declare global {
	interface Window {
		/** GhostCursorOverlay injection: cursor position update handler. */
		__taloxUpdateCursor__?: (x: number, y: number, element?: string | boolean) => void;
		/** TakeoverBridge injection: message dispatch bridge. */
		__taloxDispatch__?: (command: unknown) => void;
		/** Playwright internal properties that Talox cleans up during stealth injection. */
		__playwright?: unknown;
		__pw_manual?: unknown;
		__PW_inspect?: unknown;
	}

	// eslint-disable-next-line no-var
	var __taloxDispatch__: ((command: unknown) => void) | undefined;
	// eslint-disable-next-line no-var
	var __taloxUpdateCursor__: ((x: number, y: number) => void) | undefined;

	interface Navigator {
		/** Some browser versions expose connection info. Talox reads this during fingerprinting. */
		connection?: {
			type?: string;
			effectiveType?: string;
			downlink?: number;
			rtt?: number;
			saveData?: boolean;
		};
	}
}
