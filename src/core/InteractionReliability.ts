/**
 * @file InteractionReliability.ts
 * @description Interaction reliability gauntlet for Talox.
 *
 * Wraps browser interactions with ordered recovery strategies for the five
 * most common real-world failure modes:
 *
 * 1. `viewport`     — element outside visible area → scroll into view, retry
 * 2. `intercepted`  — element covered by overlay (modal, banner, sticky header)
 *                     → find + dismiss interceptor, retry
 * 3. `detached`     — element removed from DOM between find and click
 *                     → re-collect state, re-find by semantic label, retry
 * 4. `duplicate`    — multiple elements match selector
 *                     → score by visibility/size, pick best candidate
 * 5. `wrong-tab`    — target element exists in a different browser tab
 *                     → scan all pages, bring correct tab to front, retry
 *
 * Used by `ActionExecutor` as a replacement for the ad-hoc try/catch recovery
 * inside `click()` and `type()`.
 */

import type { ElementHandle } from "playwright";
import type { TaloxNode } from "../types/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InteractionFailureMode =
	| "viewport" // element scrolled out of visible area
	| "intercepted" // another element is covering the target
	| "detached" // element removed from DOM mid-operation
	| "duplicate" // ambiguous selector matches multiple elements
	| "wrong-tab" // element exists in a non-focused browser tab
	| "unknown"; // unclassified failure

export interface InteractionAttempt {
	/** Which failure mode was addressed. */
	mode: InteractionFailureMode;
	/** Name of the specific strategy applied. */
	strategy: string;
	/** Whether this attempt resolved the problem. */
	success: boolean;
	/** Wall-clock duration in milliseconds. */
	durationMs: number;
	/** Optional detail for artifact/trace output. */
	detail?: string;
}

export interface ReliabilityOutcome {
	/** True if the interaction was ultimately resolved. */
	resolved: boolean;
	/** The primary failure mode that was addressed, or null for clean path. */
	mode: InteractionFailureMode | null;
	/** Ordered list of recovery attempts made. */
	attempts: InteractionAttempt[];
	/**
	 * The resolved Playwright element handle ready to be clicked, or null if
	 * resolution failed. Caller owns the interaction after this.
	 */
	resolvedElement: ElementHandle | null;
	/**
	 * The final selector string that worked (may differ from original if
	 * detach/duplicate recovery produced a new one).
	 */
	resolvedSelector: string;
	/** Human-readable notes for artifact output. */
	recoveryNotes: string[];
}

// ─── Error Classifiers ────────────────────────────────────────────────────────

// Playwright / browser error message patterns for each failure mode
const INTERCEPTED_PATTERNS = [
	/is intercepted by/i,
	/element is not visible/i,
	/element.*covered/i,
	/pointer-events.*none/i,
	/hidden/i,
];

const DETACHED_PATTERNS = [
	/detached from the document/i,
	/element.*not attached/i,
	/node.*not.*dom/i,
	/stale.*element/i,
];

const VIEWPORT_PATTERNS = [
	/outside.*viewport/i,
	/element.*not.*visible.*viewport/i,
	/scrolled.*out/i,
	/element.*not.*in.*view/i,
];

const WRONG_TAB_PATTERNS = [/target.*closed/i, /execution context.*destroyed/i, /page.*closed/i];

// ─── Dismiss patterns for common overlay types ─────────────────────────────

/**
 * CSS selectors tried when attempting to dismiss an intercepting overlay.
 * Ordered from most-specific to most-generic to avoid false positives.
 */
const OVERLAY_DISMISS_SELECTORS = [
	// Cookie/consent banners
	'button[id*="accept"]',
	'button[id*="consent"]',
	'button[class*="accept"]',
	'button[class*="consent"]',
	'[aria-label*="Accept"]',
	'[aria-label*="accept cookies"]',
	// Modal close buttons
	'button[aria-label="Close"]',
	'button[aria-label="close"]',
	'[role="dialog"] button[aria-label*="close" i]',
	'[role="dialog"] button[aria-label*="dismiss" i]',
	// Generic dismissal
	'button[class*="close"]',
	'button[class*="dismiss"]',
	"[data-dismiss]",
	"[data-close]",
] as const;

// ─── InteractionReliability ───────────────────────────────────────────────────

/**
 * Stateless interaction reliability engine.
 *
 * Call `resolveBeforeClick(page, selector, nodes)` before performing a click
 * to pre-empt viewport issues and duplicate-selector ambiguity.
 *
 * Call `recoverAfterFailure(page, context, error, selector, nodes)` when a
 * click/type throws to apply progressive recovery strategies.
 *
 * @example
 * ```ts
 * const reliability = new InteractionReliability();
 *
 * // Pre-flight: scroll into view + deduplicate
 * const pre = await reliability.resolveBeforeClick(page, selector, currentNodes);
 * if (!pre.resolved) throw new Error(`Cannot resolve element: ${selector}`);
 *
 * try {
 *   await page.click(pre.resolvedSelector);
 * } catch (err) {
 *   const recovery = await reliability.recoverAfterFailure(page, ctx, err, selector, nodes);
 *   if (recovery.resolved && recovery.resolvedElement) {
 *     await recovery.resolvedElement.click();
 *   }
 * }
 * ```
 */
export class InteractionReliability {
	// ─── Pre-flight ─────────────────────────────────────────────────────────────

	/**
	 * Pre-flight check before a click/type. Handles:
	 * - Viewport: scroll target element into view
	 * - Duplicate: if `nodes` contains multiple candidates for `selector`,
	 *   score them and return the best one
	 *
	 * Returns a `ReliabilityOutcome` with `resolved=true` and `resolvedSelector`
	 * set to the selector to use. If pre-flight has nothing to do it returns
	 * `resolved=true` immediately with the original selector unchanged.
	 */
	async resolveBeforeClick(page: any, selector: string, nodes: TaloxNode[]): Promise<ReliabilityOutcome> {
		const attempts: InteractionAttempt[] = [];
		const recoveryNotes: string[] = [];
		let resolvedSelector = selector;

		// ── Duplicate resolution ─────────────────────────────────────────────────
		const duplicateResult = this.resolveDuplicateSelector(selector, nodes);
		if (duplicateResult.isDuplicate) {
			const t0 = Date.now();
			const best = duplicateResult.bestNode;
			if (best) {
				resolvedSelector = this.buildCoordinateSelector(best);
				attempts.push({
					mode: "duplicate",
					strategy: "visibility-score",
					success: true,
					durationMs: Date.now() - t0,
					detail: `Picked node ${best.id} (${best.name}) from ${duplicateResult.count} candidates`,
				});
				recoveryNotes.push(
					`Duplicate selector: ${duplicateResult.count} matches. Picked "${best.name}" (${best.role}) by visibility score.`,
				);
			}
		}

		// ── Viewport: scroll into view ───────────────────────────────────────────
		const t0 = Date.now();
		try {
			const element = await page.$(resolvedSelector);
			if (element) {
				await element.scrollIntoViewIfNeeded();
				attempts.push({
					mode: "viewport",
					strategy: "scrollIntoViewIfNeeded",
					success: true,
					durationMs: Date.now() - t0,
				});
			}
		} catch (e: any) {
			// Not a fatal pre-flight error — the element might still be findable
			attempts.push({
				mode: "viewport",
				strategy: "scrollIntoViewIfNeeded",
				success: false,
				durationMs: Date.now() - t0,
				detail: e?.message,
			});
		}

		return {
			resolved: true,
			mode: null,
			attempts,
			resolvedElement: null,
			resolvedSelector,
			recoveryNotes,
		};
	}

	// ─── Post-failure Recovery ───────────────────────────────────────────────

	/**
	 * Called when a click/type has thrown. Classifies the error and applies
	 * the cheapest matching recovery strategy.
	 *
	 * @param page        - Playwright page object
	 * @param context     - Playwright browser context (for wrong-tab recovery)
	 * @param error       - The error that was thrown
	 * @param selector    - The original selector that failed
	 * @param nodes       - Current `TaloxPageState.nodes` snapshot
	 * @returns A `ReliabilityOutcome`. If `resolved=true` the caller should
	 *          retry with `resolvedElement` or `resolvedSelector`.
	 */
	async recoverAfterFailure(
		page: any,
		context: any,
		error: unknown,
		selector: string,
		nodes: TaloxNode[],
	): Promise<ReliabilityOutcome> {
		const message = error instanceof Error ? error.message : String(error);
		const mode = this.classifyError(message);
		const attempts: InteractionAttempt[] = [];
		const recoveryNotes: string[] = [];

		switch (mode) {
			case "viewport":
				return this.recoverViewport(page, selector, attempts, recoveryNotes);

			case "intercepted":
				return this.recoverIntercepted(page, selector, attempts, recoveryNotes);

			case "detached":
				return this.recoverDetached(page, selector, nodes, attempts, recoveryNotes);

			case "wrong-tab":
				return this.recoverWrongTab(context, selector, attempts, recoveryNotes);

			default:
				return {
					resolved: false,
					mode: "unknown",
					attempts,
					resolvedElement: null,
					resolvedSelector: selector,
					recoveryNotes: [`Unclassified error: ${message}`],
				};
		}
	}

	// ─── Error Classification ─────────────────────────────────────────────────

	/**
	 * Maps a raw Playwright error message to one of the five failure modes.
	 */
	classifyError(message: string): InteractionFailureMode {
		if (DETACHED_PATTERNS.some((p) => p.test(message))) return "detached";
		if (INTERCEPTED_PATTERNS.some((p) => p.test(message))) return "intercepted";
		if (VIEWPORT_PATTERNS.some((p) => p.test(message))) return "viewport";
		if (WRONG_TAB_PATTERNS.some((p) => p.test(message))) return "wrong-tab";
		return "unknown";
	}

	// ─── Strategy: Viewport ───────────────────────────────────────────────────

	private async recoverViewport(
		page: any,
		selector: string,
		attempts: InteractionAttempt[],
		recoveryNotes: string[],
	): Promise<ReliabilityOutcome> {
		const t0 = Date.now();
		try {
			const element = await page.$(selector);
			if (!element) throw new Error("Element not found during viewport recovery");

			await element.scrollIntoViewIfNeeded();
			// Brief settle after scroll
			await new Promise((r) => setTimeout(r, 120));

			attempts.push({
				mode: "viewport",
				strategy: "scrollIntoViewIfNeeded",
				success: true,
				durationMs: Date.now() - t0,
			});
			recoveryNotes.push("Scrolled element into viewport — ready to retry.");

			return {
				resolved: true,
				mode: "viewport",
				attempts,
				resolvedElement: element,
				resolvedSelector: selector,
				recoveryNotes,
			};
		} catch (e: any) {
			attempts.push({
				mode: "viewport",
				strategy: "scrollIntoViewIfNeeded",
				success: false,
				durationMs: Date.now() - t0,
				detail: e?.message,
			});
			return {
				resolved: false,
				mode: "viewport",
				attempts,
				resolvedElement: null,
				resolvedSelector: selector,
				recoveryNotes,
			};
		}
	}

	// ─── Strategy: Intercepted ────────────────────────────────────────────────

	private async recoverIntercepted(
		page: any,
		selector: string,
		attempts: InteractionAttempt[],
		recoveryNotes: string[],
	): Promise<ReliabilityOutcome> {
		// Step 1: Try pressing Escape (most modals/overlays respond to this)
		{
			const t0 = Date.now();
			try {
				await page.keyboard.press("Escape");
				await new Promise((r) => setTimeout(r, 200));
				const element = await page.$(selector);
				if (element && (await element.isVisible())) {
					attempts.push({ mode: "intercepted", strategy: "press-escape", success: true, durationMs: Date.now() - t0 });
					recoveryNotes.push("Pressed Escape to dismiss overlay — element now visible.");
					return {
						resolved: true,
						mode: "intercepted",
						attempts,
						resolvedElement: element,
						resolvedSelector: selector,
						recoveryNotes,
					};
				}
			} catch { // NOSONAR -- non-fatal
				/* Escape did not clear it */
			}
			attempts.push({ mode: "intercepted", strategy: "press-escape", success: false, durationMs: Date.now() - t0 });
		}

		// Step 2: Try known overlay dismiss selectors
		for (const dismissSel of OVERLAY_DISMISS_SELECTORS) {
			const t0 = Date.now();
			try {
				const dismisser = await page.$(dismissSel);
				if (!dismisser || !(await dismisser.isVisible())) continue;

				await dismisser.click();
				await new Promise((r) => setTimeout(r, 300));

				const element = await page.$(selector);
				if (element && (await element.isVisible())) {
					attempts.push({
						mode: "intercepted",
						strategy: `dismiss-overlay:${dismissSel}`,
						success: true,
						durationMs: Date.now() - t0,
						detail: `Dismissed: ${dismissSel}`,
					});
					recoveryNotes.push(`Dismissed overlay via "${dismissSel}" — element now accessible.`);
					return {
						resolved: true,
						mode: "intercepted",
						attempts,
						resolvedElement: element,
						resolvedSelector: selector,
						recoveryNotes,
					};
				}
			} catch { // NOSONAR -- non-fatal
				/* try next */
			}
			attempts.push({
				mode: "intercepted",
				strategy: `dismiss-overlay:${dismissSel}`,
				success: false,
				durationMs: Date.now() - t0,
			});
		}

		// Step 3: Force-click at coordinates (bypasses CSS pointer-event guards)
		{
			const t0 = Date.now();
			try {
				const element = await page.$(selector);
				if (element) {
					const box = await element.boundingBox();
					if (box) {
						// dispatchEvent bypasses Playwright's "is intercepted?" check
						await page.evaluate(
							([sel]: [string]) => {
								const el = document.querySelector(sel);
								if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
							},
							[selector] as [string],
						);
						await new Promise((r) => setTimeout(r, 200));
						attempts.push({
							mode: "intercepted",
							strategy: "dispatch-click",
							success: true,
							durationMs: Date.now() - t0,
						});
						recoveryNotes.push("Used dispatchEvent click to bypass CSS intercept layer.");
						return {
							resolved: true,
							mode: "intercepted",
							attempts,
							resolvedElement: element,
							resolvedSelector: selector,
							recoveryNotes,
						};
					}
				}
			} catch { // NOSONAR -- non-fatal
				/* dispatch failed */
			}
			attempts.push({ mode: "intercepted", strategy: "dispatch-click", success: false, durationMs: Date.now() - t0 });
		}

		return {
			resolved: false,
			mode: "intercepted",
			attempts,
			resolvedElement: null,
			resolvedSelector: selector,
			recoveryNotes,
		};
	}

	// ─── Strategy: Detached ──────────────────────────────────────────────────

	private findBestNodeMatch(keywords: string[], nodes: TaloxNode[]): { node: TaloxNode | null; score: number } {
		let bestNode: TaloxNode | null = null;
		let bestScore = 0;

		for (const node of nodes) {
			let score = 0;
			const nodeText = (node.name || "").toLowerCase();
			const nodeRole = (node.role || "").toLowerCase();

			for (const kw of keywords) {
				const lkw = kw.toLowerCase();
				if (nodeText.includes(lkw)) score += 10;
				if (nodeRole.includes(lkw)) score += 3;
				if (node.id.toLowerCase().includes(lkw)) score += 2;
			}

			if (score > bestScore) {
				bestScore = score;
				bestNode = node;
			}
		}

		return { node: bestNode, score: bestScore };
	}

	private async recoverDetached(
		page: any,
		selector: string,
		nodes: TaloxNode[],
		attempts: InteractionAttempt[],
		recoveryNotes: string[],
	): Promise<ReliabilityOutcome> {
		const t0 = Date.now();

		// Extract label keywords from the selector (strip CSS syntax)
		const label = selector
			.replaceAll(/#.[\]()=:"'*^$|~]/g, " ")
			.replaceAll(/\s+/g, " ")
			.trim();

		const keywords = label.split(/[\s_-]+/).filter((k) => k.length > 2);

		const { node: bestNode, score: bestScore } = this.findBestNodeMatch(keywords, nodes);

		if (bestScore >= 10 && bestNode) {
			const healedSelector = this.buildCoordinateSelector(bestNode);
			try {
				const element = (await page.$(healedSelector)) ?? (await page.locator(`text=${bestNode.name}`).first());
				attempts.push({
					mode: "detached",
					strategy: "semantic-re-find",
					success: true,
					durationMs: Date.now() - t0,
					detail: `Re-found as ${bestNode.role} "${bestNode.name}"`,
				});
				recoveryNotes.push(`Detached element re-found by semantic label: "${bestNode.name}" (${bestNode.role})`);
				return {
					resolved: true,
					mode: "detached",
					attempts,
					resolvedElement: element,
					resolvedSelector: healedSelector,
					recoveryNotes,
				};
			} catch { // NOSONAR -- non-fatal
				/* fall through */
			}
		}

		attempts.push({ mode: "detached", strategy: "semantic-re-find", success: false, durationMs: Date.now() - t0 });
		recoveryNotes.push(`Detached element: could not re-find "${label}" in current DOM snapshot.`);
		return {
			resolved: false,
			mode: "detached",
			attempts,
			resolvedElement: null,
			resolvedSelector: selector,
			recoveryNotes,
		};
	}

	// ─── Strategy: Wrong Tab ─────────────────────────────────────────────────

	private async recoverWrongTab(
		context: any,
		selector: string,
		attempts: InteractionAttempt[],
		recoveryNotes: string[],
	): Promise<ReliabilityOutcome> {
		const t0 = Date.now();

		if (!context || typeof context.pages !== "function") {
			attempts.push({
				mode: "wrong-tab",
				strategy: "scan-pages",
				success: false,
				durationMs: Date.now() - t0,
				detail: "No browser context available",
			});
			return {
				resolved: false,
				mode: "wrong-tab",
				attempts,
				resolvedElement: null,
				resolvedSelector: selector,
				recoveryNotes,
			};
		}

		const pages: any[] = context.pages();

		for (const candidatePage of pages) {
			try {
				const element = await candidatePage.$(selector);
				if (!element) continue;

				const isVisible = await element.isVisible();
				if (!isVisible) continue;

				// Bring this tab to front
				await candidatePage.bringToFront();
				await new Promise((r) => setTimeout(r, 100));

				attempts.push({
					mode: "wrong-tab",
					strategy: "bring-tab-to-front",
					success: true,
					durationMs: Date.now() - t0,
					detail: `Found on: ${candidatePage.url()}`,
				});
				recoveryNotes.push(`Wrong-tab recovery: element found on "${candidatePage.url()}" — brought to front.`);
				return {
					resolved: true,
					mode: "wrong-tab",
					attempts,
					resolvedElement: element,
					resolvedSelector: selector,
					recoveryNotes,
				};
			} catch { // NOSONAR -- non-fatal
				/* try next page */
			}
		}

		attempts.push({ mode: "wrong-tab", strategy: "scan-pages", success: false, durationMs: Date.now() - t0 });
		recoveryNotes.push(`Wrong-tab recovery: element "${selector}" not found on any of ${pages.length} open tabs.`);
		return {
			resolved: false,
			mode: "wrong-tab",
			attempts,
			resolvedElement: null,
			resolvedSelector: selector,
			recoveryNotes,
		};
	}

	// ─── Duplicate Label Resolution ──────────────────────────────────────────

	/**
	 * Checks whether `selector` (interpreted as an accessible name) matches
	 * multiple nodes in `nodes`. If so, scores candidates by visibility
	 * (prefer nodes with larger bounding boxes in the upper-left quadrant)
	 * and returns the best.
	 */
	resolveDuplicateSelector(
		selector: string,
		nodes: TaloxNode[],
	): { isDuplicate: boolean; count: number; bestNode: TaloxNode | null } {
		// Extract a plain-text label from the selector
		const label = selector
			.replaceAll(/[#.[\]()=:"'*^$|~]/g, " ")
			.replaceAll(/\s+/g, " ")
			.trim()
			.toLowerCase();

		if (!label) return { isDuplicate: false, count: 0, bestNode: null };

		const matches = nodes.filter((n) => {
			const name = (n.name || "").toLowerCase();
			return name === label || name.includes(label);
		});

		if (matches.length <= 1) return { isDuplicate: false, count: matches.length, bestNode: matches[0] ?? null };

		// Score by: large bounding box (more prominent) + high on page (more likely the primary)
		const scored = matches.map((n) => {
			const area = n.boundingBox.width * n.boundingBox.height;
			// Favour elements in the upper 60% of the page
			const verticalBonus = n.boundingBox.y < 600 ? 1.2 : 1;
			return { node: n, score: area * verticalBonus };
		});

		scored.sort((a, b) => b.score - a.score);
		return { isDuplicate: true, count: matches.length, bestNode: scored[0]?.node ?? null };
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	/**
	 * Builds an approximate selector from a node's bounding box position
	 * for use after detach/duplicate recovery. Falls back to the node's `id`.
	 */
	private buildCoordinateSelector(node: TaloxNode): string {
		// Use node.id which is the AX node id set by PageStateCollector
		return node.id;
	}
}
