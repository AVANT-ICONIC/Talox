/**
 * @file CrossOriginManager.ts
 * @description Manages CDP sessions for cross-origin iframes.
 *
 * Cross-origin iframes require dedicated CDP sessions to interact with their
 * DOM. This manager auto-detects cross-origin frames and creates sessions
 * so agents can execute CDP commands inside them.
 */

import type { CDPSession, Frame, Page } from "playwright-core";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IframeSession {
	frameId: string;
	cdpSession: CDPSession;
	origin: string;
}

// ─── CrossOriginManager ────────────────────────────────────────────────────

export class CrossOriginManager {
	private readonly sessions = new Map<string, IframeSession>();
	private page: Page | null = null;
	private mainCdpSession: CDPSession | null = null;

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

	/**
	 * Execute a CDP command inside the given frame's CDP session.
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
			const origin = this.extractOrigin(frameUrl);

			this.sessions.set(frameId, {
				frameId,
				cdpSession,
				origin,
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
			// NOSONAR — invalid URL, treat as same-origin
			return false;
		}
	}

	private extractOrigin(url: string): string {
		try {
			return new URL(url).origin;
		} catch {
			return url;
		}
	}
}
