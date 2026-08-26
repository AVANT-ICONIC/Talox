/**
 * @file NetworkGuard.ts
 * @description Client-side JS network interception for APIs that Playwright's
 * `page.route()` cannot catch: `navigator.sendBeacon()`, `WebSocket`,
 * and belt-and-suspenders overrides for `fetch` / `XMLHttpRequest`.
 *
 * This module **complements** `SessionManager.attachSecurityHooks()`, which
 * already intercepts all requests at the Playwright-protocol level and blocks
 * credential leaks (JWT tokens, API keys) for the `ops` profile.
 *
 * NetworkGuard adds a page-context JS layer that catches what protocol-level
 * routing misses — fire-and-forget beacons, WebSocket upgrades, and edge cases
 * where fetch/XHR bypass route interception.
 *
 * Tiers mirror ContentSanitizer:
 * - `"off"`  — no JS injection (zero overhead)
 * - `"warn"` — injects JS that logs blocked requests to console but allows them
 * - `"strict"` — injects JS that blocks sendBeacon/WebSocket to non-allowlisted
 *   origins and logs all denied requests
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type NetworkGuardLevel = "off" | "warn" | "strict";

export interface NetworkGuardOptions {
	level: NetworkGuardLevel;
	/** Domains allowed for outbound requests (from PolicyEngine allowlist). */
	allowlist: string[];
	/** Profile class for logging context. */
	profileClass?: string;
}

// ─── Init Script Builder ──────────────────────────────────────────────────────

/**
 * Build a self-contained JavaScript string for injection via `page.addInitScript()`.
 *
 * The script overrides `navigator.sendBeacon`, `WebSocket`, `fetch`, and
 * `XMLHttpRequest.prototype.open` to enforce the allowlist.
 *
 * In "warn" mode, requests to non-allowlisted origins are logged but allowed.
 * In "strict" mode, sendBeacon returns false, WebSocket throws, and fetch/XHR
 * are aborted for non-allowlisted destinations.
 *
 * Always allows:
 * - Relative URLs and same-origin requests
 * - `blob:` and `data:` URLs
 * - Requests to origins in the allowlist
 */
function buildInitScript(options: NetworkGuardOptions): string {
	const allowlistJson = JSON.stringify(options.allowlist);
	const level = options.level;
	const profileClass = options.profileClass ?? "unknown";

	// We build the script as a string to inject into the page context.
	// This runs BEFORE any page scripts, so it intercepts everything.

	return `(function() {
	var TALOX_NG_LEVEL = ${JSON.stringify(level)};
	var TALOX_NG_ALLOW = ${allowlistJson};
	var TALOX_NG_PROFILE = ${JSON.stringify(profileClass)};

	if (TALOX_NG_LEVEL === 'off') return;
	if (window.__taloxNetworkGuardInstalled === true) return;

	// ── Helpers ──────────────────────────────────────────────────────────

	function normalizeUrlInput(url) {
		if (typeof url === 'string') return url;
		if (url && typeof url.url === 'string') return url.url;
		if (url && typeof url.href === 'string') return url.href;
		try { return String(url); } catch(e) { return null; }
	}

	function isSameOrigin(url) {
		var normalized = normalizeUrlInput(url);
		if (normalized === null) return false;
		try {
			return new URL(normalized, location.href).origin === location.origin;
		} catch(e) { return false; }
	}

	function isSpecialScheme(url) {
		var normalized = normalizeUrlInput(url);
		return normalized !== null && /^(blob|data|javascript|about):/i.test(normalized);
	}

	function isAllowed(url) {
		var normalized = normalizeUrlInput(url);
		if (normalized === null) return false;
		if (isSameOrigin(normalized) || isSpecialScheme(normalized)) return true;
		try {
			var host = new URL(normalized, location.href).hostname;
			for (var i = 0; i < TALOX_NG_ALLOW.length; i++) {
				if (TALOX_NG_ALLOW[i] === '*' || host === TALOX_NG_ALLOW[i] || host.endsWith('.' + TALOX_NG_ALLOW[i])) {
					return true;
				}
			}
			return false;
		} catch(e) { return false; }
	}

	function logBlocked(api, url) {
		var msg = '[Talox NetworkGuard:' + TALOX_NG_PROFILE + '] BLOCKED ' + api + ' to ' + url;
		if (TALOX_NG_LEVEL === 'strict') {
			console.error(msg);
		} else {
			console.warn(msg + ' (warn mode — request allowed)');
		}
	}

	// ── navigator.sendBeacon ─────────────────────────────────────────────

	var _origSendBeacon = navigator.sendBeacon.bind(navigator);
	navigator.sendBeacon = function(url, data) {
		if (!isAllowed(url)) {
			logBlocked('sendBeacon', url);
			if (TALOX_NG_LEVEL === 'strict') return false;
		}
		return _origSendBeacon(url, data);
	};

	// ── WebSocket ────────────────────────────────────────────────────────

	var _OrigWebSocket = WebSocket;
	window.WebSocket = function(url, protocols) {
		if (!isAllowed(url)) {
			logBlocked('WebSocket', url);
			if (TALOX_NG_LEVEL === 'strict') {
				throw new Error('[Talox NetworkGuard] WebSocket connection blocked to ' + url);
			}
		}
		return new _OrigWebSocket(url, protocols);
	};
	window.WebSocket.prototype = _OrigWebSocket.prototype;
	window.WebSocket.CONNECTING = _OrigWebSocket.CONNECTING;
	window.WebSocket.OPEN = _OrigWebSocket.OPEN;
	window.WebSocket.CLOSING = _OrigWebSocket.CLOSING;
	window.WebSocket.CLOSED = _OrigWebSocket.CLOSED;

	// ── fetch (belt-and-suspenders) ──────────────────────────────────────

	var _origFetch = window.fetch;
	window.fetch = function(url, init) {
		var urlStr = normalizeUrlInput(url);
		if (!isAllowed(urlStr)) {
			logBlocked('fetch', urlStr);
			if (TALOX_NG_LEVEL === 'strict') {
				return Promise.reject(new Error('[Talox NetworkGuard] fetch blocked to ' + urlStr));
			}
		}
		return _origFetch.apply(this, arguments);
	};

	// ── XMLHttpRequest (belt-and-suspenders) ─────────────────────────────

	var _origOpen = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function(method, url) {
		if (!isAllowed(url)) {
			logBlocked('XHR', url);
			if (TALOX_NG_LEVEL === 'strict') {
				// Store block flag — actual abort happens in send()
				this.__talox_blocked = true;
			}
		}
		return _origOpen.apply(this, arguments);
	};

	var _origSend = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.send = function() {
		if (this.__talox_blocked) {
			logBlocked('XHR (send)', '');
			this.abort();
			return;
		}
		return _origSend.apply(this, arguments);
	};

	window.__taloxNetworkGuardInstalled = true;
})();`;
}

// ─── NetworkGuard ─────────────────────────────────────────────────────────────

/**
 * Client-side network interception guard.
 *
 * Complements `SessionManager.attachSecurityHooks()` (Playwright protocol-level)
 * with page-context JS overrides for APIs that protocol routing misses.
 *
 * @example
 * ```ts
 * const guard = new NetworkGuard({ level: "strict", allowlist: ["github.com"] });
 * await guard.inject(page);
 * // All sendBeacon/WebSocket/fetch/XHR to non-github.com origins are now blocked
 * ```
 */
export class NetworkGuard {
	private readonly options: NetworkGuardOptions;
	private readonly script: string;

	constructor(options: NetworkGuardOptions) {
		this.options = options;
		this.script = buildInitScript(options);
	}

	// ─── Public API ─────────────────────────────────────────────────────────────

	/**
	 * Inject the network guard script into a Playwright page.
	 * Must be called before page scripts execute (i.e., via `addInitScript`
	 * before navigation, or immediately after page creation with the guard
	 * script preloaded).
	 *
	 * Safe to call multiple times — the script guards against double-injection.
	 */
	async inject(page: { addInitScript: (script: string) => Promise<unknown> }): Promise<void> {
		if (this.options.level === "off") return;
		await page.addInitScript(this.script);
	}

	/**
	 * The currently active guard level.
	 */
	get level(): NetworkGuardLevel {
		return this.options.level;
	}

	/**
	 * The allowlist in use.
	 */
	get allowlist(): readonly string[] {
		return this.options.allowlist;
	}
}

/**
 * Create a NetworkGuard from a level string and allowlist.
 * Convenience factory for wiring into SessionManager.
 */
export function createNetworkGuard(
	level: NetworkGuardLevel = "off",
	allowlist: string[] = [],
	profileClass?: string,
): NetworkGuard {
	const opts: NetworkGuardOptions = { level, allowlist };
	if (profileClass !== undefined) opts.profileClass = profileClass;
	return new NetworkGuard(opts);
}
