/**
 * @file CrossOriginManager.ts
 * @description Manages CDP sessions and trust metadata for cross-origin iframes.
 *
 * Cross-origin iframes require dedicated CDP sessions to interact with their
 * DOM. This manager auto-detects cross-origin frames and creates sessions so
 * agents can execute CDP commands inside them. Trust is deliberately separate
 * from reachability: a frame can be technically accessible while still being
 * untrusted input.
 */

import type { CDPSession, Frame, Page } from "playwright-core";

// ─── Types ──────────────────────────────────────────────────────────────────

export type IframeTrustLevel = "trusted" | "untrusted" | "opaque";

export type IframeTrustReason =
	| "same-origin"
	| "explicit-trusted-origin"
	| "cross-origin-default-deny"
	| "opaque-origin"
	| "invalid-url";

export interface IframeTrustDecision {
	level: IframeTrustLevel;
	trusted: boolean;
	reason: IframeTrustReason;
	origin: string;
	parentOrigin: string;
}

export interface CrossOriginManagerOptions {
	/**
	 * Exact origins that may be treated as trusted when embedded cross-origin.
	 * Paths are ignored and normalized to URL origins. Wildcards are deliberately
	 * unsupported because trust policy should not quietly expand to attacker
	 * controlled sibling/subdomains.
	 */
	trustedOrigins?: readonly string[];
}

export interface IframeSession {
	frameId: string;
	cdpSession: CDPSession;
	origin: string;
	trust: IframeTrustDecision;
}

// ─── CrossOriginManager ────────────────────────────────────────────────────

export class CrossOriginManager {
	private readonly sessions = new Map<string, IframeSession>();
	private readonly trustedOrigins: Set<string>;
	private page: Page | null = null;
	private mainCdpSession: CDPSession | null = null;

	constructor(options: CrossOriginManagerOptions = {}) {
		this.trustedOrigins = this.normalizeTrustedOrigins(options.trustedOrigins ?? []);
	}

	/**
	 * Install frame listeners on the given page.
	 * Call after the page has been created (e.g. after `launch()`).
	 */
	install(page: Page): void {
		this.page = page;

		page.on("frameattached", (frame: Frame) => this.handleFrameAttached(frame));
		page.on("framenavigated", (frame: Frame) => this.handleFrameNavigated(frame));
		page.on("framedetached", (frame: Frame) => this.handleFrameDetached(frame));
	}

	/**
	 * Look up the CDP session for a given frame ID.
	 */
	getSession(frameId: string): IframeSession | undefined {
		return this.sessions.get(frameId);
	}

	/**
	 * Return all tracked cross-origin iframe sessions.
	 */
	getAllSessions(): IframeSession[] {
		return Array.from(this.sessions.values());
	}

	/** Return all explicitly trusted cross-origin sessions. */
	getTrustedSessions(): IframeSession[] {
		return this.getAllSessions().filter((session) => session.trust.trusted);
	}

	/** Return all untrusted or opaque cross-origin sessions. */
	getUntrustedSessions(): IframeSession[] {
		return this.getAllSessions().filter((session) => !session.trust.trusted);
	}

	/** Return the current trust decision for a tracked frame. */
	getTrust(frameId: string): IframeTrustDecision | undefined {
		return this.sessions.get(frameId)?.trust;
	}

	/** Convenience predicate for policy gates. Unknown frames are never trusted. */
	isTrusted(frameId: string): boolean {
		return this.sessions.get(frameId)?.trust.trusted === true;
	}

	/**
	 * Evaluate a frame URL against its parent without creating a browser session.
	 *
	 * Security posture is default-deny: same-origin is trusted, exact origins in
	 * `trustedOrigins` are trusted, and every other valid cross-origin URL is
	 * untrusted. Opaque schemes such as data:/about: are never allowlisted.
	 */
	assessTrust(frameUrl: string, parentUrl: string): IframeTrustDecision {
		let frame: URL;
		let parent: URL;
		try {
			frame = new URL(frameUrl);
			parent = new URL(parentUrl);
		} catch {
			return {
				level: "opaque",
				trusted: false,
				reason: "invalid-url",
				origin: frameUrl,
				parentOrigin: parentUrl,
			};
		}

		const origin = frame.origin;
		const parentOrigin = parent.origin;
		if (origin === "null" || parentOrigin === "null") {
			return { level: "opaque", trusted: false, reason: "opaque-origin", origin, parentOrigin };
		}
		if (origin === parentOrigin) {
			return { level: "trusted", trusted: true, reason: "same-origin", origin, parentOrigin };
		}
		if (this.trustedOrigins.has(origin)) {
			return { level: "trusted", trusted: true, reason: "explicit-trusted-origin", origin, parentOrigin };
		}
		return { level: "untrusted", trusted: false, reason: "cross-origin-default-deny", origin, parentOrigin };
	}

	/**
	 * Execute a CDP command inside the given frame's CDP session.
	 *
	 * This backward-compatible method does not enforce trust. Security-sensitive
	 * callers should prefer `executeInTrustedFrame()`.
	 *
	 * @param frameId - The frame ID to target.
	 * @param command - CDP method name (e.g. `"Runtime.evaluate"`).
	 * @param params  - Optional parameters for the CDP command.
	 * @returns The CDP result.
	 * @throws If no session exists for the given frame.
	 */
	async executeInFrame(frameId: string, command: string, params?: Record<string, unknown>): Promise<unknown> {
		const session = this.sessions.get(frameId);
		if (!session) {
			throw new Error(`No CDP session for frame: ${frameId}`);
		}
		return session.cdpSession.send(command as any, params);
	}

	/**
	 * Execute only when the tracked iframe is trusted by policy.
	 * Unknown, opaque, and default-denied origins are rejected before CDP send.
	 */
	async executeInTrustedFrame(frameId: string, command: string, params?: Record<string, unknown>): Promise<unknown> {
		const session = this.sessions.get(frameId);
		if (!session) throw new Error(`No CDP session for frame: ${frameId}`);
		if (!session.trust.trusted) {
			throw new Error(
				`Refusing trusted-frame execution for '${frameId}': ${session.trust.origin} is ${session.trust.level} (${session.trust.reason}).`,
			);
		}
		return session.cdpSession.send(command as any, params);
	}

	/**
	 * Clean up all CDP sessions and remove listeners.
	 */
	dispose(): void {
		for (const [, session] of Array.from(this.sessions.entries())) {
			session.cdpSession.detach().catch(() => {}); // NOSONAR — best-effort cleanup
		}
		this.sessions.clear();
		this.mainCdpSession = null;
		this.page = null;
	}

	// ── Internal helpers ───────────────────────────────────────────────────

	private async handleFrameAttached(frame: Frame): Promise<void> {
		// Only process sub-frames, not the main frame
		if (!frame.parentFrame()) return;
		await this.tryCreateSession(frame);
	}

	private async handleFrameNavigated(frame: Frame): Promise<void> {
		if (!frame.parentFrame()) return;
		// Clean up old session if it exists, then re-evaluate
		this.removeSession(frame);
		await this.tryCreateSession(frame);
	}

	private handleFrameDetached(frame: Frame): void {
		this.removeSession(frame);
	}

	private async tryCreateSession(frame: Frame): Promise<void> {
		if (!this.page) return;

		const parentFrame = frame.parentFrame();
		if (!parentFrame) return;

		const frameUrl = frame.url();
		if (!frameUrl) return;

		const parentUrl = parentFrame.url();
		if (!this.isCrossOrigin(frameUrl, parentUrl)) return;

		try {
			const cdpSession = await this.page.context().newCDPSession(this.page);

			const frameId = this.resolveFrameId(frame);
			const trust = this.assessTrust(frameUrl, parentUrl);

			this.sessions.set(frameId, {
				frameId,
				cdpSession,
				origin: trust.origin,
				trust,
			});
		} catch {
			// NOSONAR — CDP session creation can fail for certain frame types
		}
	}

	private removeSession(frame: Frame): void {
		const frameId = this.resolveFrameId(frame);
		const existing = this.sessions.get(frameId);
		if (existing) {
			existing.cdpSession.detach().catch(() => {}); // NOSONAR — best-effort cleanup
			this.sessions.delete(frameId);
		}
	}

	private resolveFrameId(frame: Frame): string {
		// Playwright Frame has an internal _id or name; use name as a stable key.
		// Fall back to the frame's URL hash if name is empty.
		const name = frame.name();
		if (name) return name;
		// Use a combination of URL + parent to create a unique key
		return `frame:${frame.url()}`;
	}

	private isCrossOrigin(frameUrl: string, parentUrl: string): boolean {
		try {
			const frameOrigin = new URL(frameUrl).origin;
			const parentOrigin = new URL(parentUrl).origin;
			return frameOrigin !== parentOrigin;
		} catch {
			// NOSONAR — invalid URL, preserve existing behavior and ignore it
			return false;
		}
	}

	private normalizeTrustedOrigins(origins: readonly string[]): Set<string> {
		const normalized = new Set<string>();
		for (const value of origins) {
			if (typeof value !== "string" || value.trim().length === 0) {
				throw new TypeError("trustedOrigins entries must be non-empty URL strings.");
			}
			let origin: string;
			try {
				origin = new URL(value).origin;
			} catch {
				throw new TypeError(`Invalid trusted iframe origin: ${value}`);
			}
			if (origin === "null") {
				throw new TypeError(`Opaque origins cannot be trusted: ${value}`);
			}
			normalized.add(origin);
		}
		return normalized;
	}
}