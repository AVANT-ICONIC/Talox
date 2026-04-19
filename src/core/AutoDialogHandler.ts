/**
 * @file AutoDialogHandler.ts
 * @description Automatically handles browser dialogs (alert, confirm, prompt, beforeunload)
 * so that automation sessions are not blocked by unexpected popups.
 */

import type { Page } from "playwright";
import type { TaloxEventMap } from "../types/events.js";
import type { EventBus } from "./controller/EventBus.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Record of a single dialog that was automatically handled. */
export interface DialogRecord {
	type: string;
	message: string;
	timestamp: number;
	action: "accepted" | "dismissed";
}

// ─── AutoDialogHandler ──────────────────────────────────────────────────────

/**
 * Automatically accepts or dismisses browser dialogs so the automation
 * session is never blocked by unexpected `alert()`, `confirm()`, `prompt()`,
 * or `beforeunload` dialogs.
 *
 * Usage:
 * ```ts
 * const handler = new AutoDialogHandler(events, verbosity);
 * handler.install(page);
 * // ... later ...
 * handler.dispose();
 * ```
 */
export class AutoDialogHandler {
	private enabled: boolean = true;
	private readonly verbosity: number;
	private readonly events: EventBus<TaloxEventMap>;

	/** Total number of dialogs handled so far. */
	handledCount: number = 0;
	/** Chronological log of every dialog that was handled. */
	records: DialogRecord[] = [];

	/** Holds references to the bound listener so we can remove it on dispose. */
	private readonly boundListener: (dialog: any) => Promise<void>;
	/** Pages we have attached listeners to. */
	private readonly installedPages: Set<any> = new Set();

	constructor(events: EventBus<TaloxEventMap>, verbosity: number = 0) {
		this.events = events;
		this.verbosity = verbosity;
		this.boundListener = this.handleDialog.bind(this);
	}

	// ─── Install / Dispose ──────────────────────────────────────────────────

	/**
	 * Install the dialog handler on a Playwright `Page`.
	 * Call this after the page is created.
	 */
	install(page: Page): void {
		if (this.installedPages.has(page)) return;
		page.on("dialog", this.boundListener);
		this.installedPages.add(page);
	}

	/**
	 * Remove all dialog listeners from all installed pages.
	 */
	dispose(): void {
		const pages = Array.from(this.installedPages);
		for (const page of pages) {
			try {
				page.off("dialog", this.boundListener);
			} catch { // NOSONAR -- non-fatal
				// NOSONAR — page may already be closed
			}
		}
		this.installedPages.clear();
	}

	// ─── Enable / Disable ──────────────────────────────────────────────────

	/** Enable auto-handling (default). */
	enable(): void {
		this.enabled = true;
	}

	/** Disable auto-handling — dialogs will pass through to the browser. */
	disable(): void {
		this.enabled = false;
	}

	/** Check whether the handler is currently enabled. */
	isEnabled(): boolean {
		return this.enabled;
	}

	// ─── Private: Dialog Handling ───────────────────────────────────────────

	private async handleDialog(dialog: any): Promise<void> {
		if (!this.enabled) return;

		const type = dialog.type() as string;
		const message = dialog.message() as string;
		const timestamp = Date.now();
		let action: "accepted" | "dismissed";

		switch (type) {
			case "alert":
			case "confirm":
				action = "accepted";
				await dialog.accept();
				break;

			case "prompt":
				action = "accepted";
				await dialog.accept("");
				break;

			case "beforeunload":
			// fallthrough — same as default: dismiss unknown/unload dialogs
		default:
			action = "dismissed";
			await dialog.dismiss();
			break;
		}

		this.handledCount++;
		const record: DialogRecord = { type, message, timestamp, action };
		this.records.push(record);

		if (this.verbosity > 0) {
			console.log(`[AutoDialog] ${type} ${action}: "${message.slice(0, 80)}"`);
		}

		this.events.emit("dialogHandled", { type, message, action });
	}
}
