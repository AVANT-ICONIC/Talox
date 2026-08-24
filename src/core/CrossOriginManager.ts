/**
 * @file CrossOriginManager.ts
 * @description Manages frame-scoped CDP sessions and trust metadata for cross-origin iframes.
 *
 * Cross-origin iframes require dedicated CDP sessions to interact with their
 * DOM. This manager auto-detects cross-origin frames and creates sessions so
 * agents can execute CDP commands inside them. Reachability and trust remain
 * separate: a frame can be technically accessible while still being external,
 * untrusted content.
 */

import type { CDPSession, Frame, Page } from "playwright-core";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Aligns with TaloxPageState element/node trust annotations. */
export type IframeTrustLevel = "first-party" | "external" | "opaque";

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
	 * Known-safe domains/origins. Bare domains are interpreted as HTTPS origins;
	 * URL paths are ignored and normalized to the exact origin. Wildcards are
	 * rejected so trust cannot silently expand to sibling or child subdomains.
	 *
	 * This mirrors `TaloxSettings.trustedDomains`.
	 */
	trustedDomains?: readonly string[];
	/** @deprecated Use `trustedDomains` to match the TaloxSettings contract. */
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
	private readonly frameIds = new WeakMap<Frame, string>();
	private readonly assignedFrameIds = new Set<string>();
	private nextFrameId = 1;
	private page: Page | null = null;
	private mainCdpSession: CDPSession | null = null;

	constructor(options: CrossOriginManagerOptions = {}) {
		const configured = [...(options.trustedDomains ?? []), ...(options.trustedOrigins ?? [])];
		this.trustedOrigins = this.normalizeTrustedDomains(configured);
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

	/** Look up the CDP session for a given stable frame ID. */
	getSession(frameId: string): IframeSession | undefined {
		return this.sessions.get(frameId);
	}

	/** Return all tracked cross-origin iframe sessions. */
	getAllSessions(): IframeSession[] {
		return Array.from(this.sessions.values());
	}

	/** Return all sessions currently trusted by policy. */
	getTrustedSessions(): IframeSession[] {
		return this.getAllSessions().filter((session) => session.trust.trusted);
	}

	/** Return all external or opaque sessions. */
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
	 * Security posture is default-deny: same-origin is first-party, exact origins
	 * from `trustedDomains` are promoted to first-party trust, and every other
	 * valid cross-origin URL is external. Opaque schemes such as data:/about: are
	 * never allowlisted.
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
			return { level: "first-party", trusted: true, reason: "same-origin", origin, parentOrigin };
		}
		if (this.trustedOrigins.has(origin)) {
			return { level: "first-party", trusted: true, reason: "explicit-trusted-origin", origin, parentOrigin };
		}
		return { level: "external", trusted: false, reason: "cross-origin-default-deny", origin, parentOrigin };
	}

	/**
	 * Execute a CDP command inside the given frame's CDP session.
	 *
	 * This backward-compatible method does not enforce trust. Security-sensitive
	 * callers should prefer `executeInTrustedFrame()`.
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
	 * Unknown, opaque, and default-denied external origins are rejected before CDP send.
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

	/** Clean up all CDP sessions and remove manager state. */
	dispose(): void {
		for (const [, session] of Array.from(this.sessions.entries())) {
			session.cdpSession.detach().catch(() => {}); // NOSONAR — best-effort cleanup
		}
		this.sessions.clear();
		this.assignedFrameIds.clear();
		this.mainCdpSession = null;
		this.page = null;
	}

	// ── Internal helpers ───────────────────────────────────────────────────

	private async handleFrameAttached(frame: Frame): Promise<void> {
		if (!frame.parentFrame()) return;
		await this.tryCreateSession(frame);
	}

	private async handleFrameNavigated(frame: Frame): Promise<void> {
		if (!frame.parentFrame()) return;
		// Invalidate the previous session/trust before evaluating the new URL.
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
			// Playwright scopes this CDP session to the OOPIF target. Passing the
			// page here would make a trust-gated frame command execute on the page.
			const cdpSession = await this.page.context().newCDPSession(frame);
			const frameId = this.resolveFrameId(frame);
			const trust = this.assessTrust(frameUrl, parentUrl);

			this.sessions.set(frameId, {
				frameId,
				cdpSession,
				origin: trust.origin,
				trust,
			});
		} catch {
			// NOSONAR — frames without a separate CDP target cannot get a session
		}
	}

	private removeSession(frame: Frame): void {
		const frameId = this.frameIds.get(frame);
		if (!frameId) return;
		const existing = this.sessions.get(frameId);
		if (existing) {
			existing.cdpSession.detach().catch(() => {}); // NOSONAR — best-effort cleanup
			this.sessions.delete(frameId);
		}
	}

	/**
	 * Assign one ID per Frame object and never recompute it after the first sighting.
	 * Named frames keep their historical ID. For compatibility, an unnamed frame's
	 * initial URL seeds its ID, but the WeakMap pins that ID across later navigation.
	 * Collisions receive a monotonic suffix that is never reused during manager life.
	 */
	private resolveFrameId(frame: Frame): string {
		const existing = this.frameIds.get(frame);
		if (existing) return existing;

		const name = frame.name().trim();
		const initialBase = name || `frame:${frame.url()}`;
		let frameId = initialBase;
		if (this.assignedFrameIds.has(frameId)) {
			do {
				frameId = `${initialBase}:${this.nextFrameId++}`;
			} while (this.assignedFrameIds.has(frameId));
		}

		this.frameIds.set(frame, frameId);
		this.assignedFrameIds.add(frameId);
		return frameId;
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

	/** Normalize Talox trustedDomains into conservative exact origins. */
	private normalizeTrustedDomains(domains: readonly string[]): Set<string> {
		const normalized = new Set<string>();
		for (const rawValue of domains) {
			if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
				throw new TypeError("trustedDomains entries must be non-empty URL/domain strings.");
			}
			const value = rawValue.trim();
			if (value.includes("*")) {
				throw new TypeError(`Wildcard trusted domains are not supported: ${value}`);
			}

			let origin: string;
			try {
				const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) ? value : `https://${value}`;
				origin = new URL(candidate).origin;
			} catch {
				throw new TypeError(`Invalid trusted iframe domain/origin: ${value}`);
			}
			if (origin === "null") {
				throw new TypeError(`Opaque origins cannot be trusted: ${value}`);
			}
			normalized.add(origin);
		}
		return normalized;
	}
}
