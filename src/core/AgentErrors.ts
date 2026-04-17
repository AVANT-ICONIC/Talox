/**
 * @file AgentErrors.ts
 * @description Converts raw Playwright/browser errors into self-correcting,
 * AI-friendly messages that tell agents what to do differently.
 *
 * Each pattern match produces an {@link AgentError} with:
 * - `friendly`  — human/AI-readable remediation message
 * - `category`  — broad error class for programmatic routing
 * - `suggestion`— concrete next action the agent should take
 */

// ─── Public types ────────────────────────────────────────────────────────────

export type AgentErrorCategory =
	| 'selector'
	| 'timing'
	| 'navigation'
	| 'network'
	| 'browser'
	| 'interaction'
	| 'unknown';

export interface AgentError {
	original: string;
	friendly: string;
	category: AgentErrorCategory;
	suggestion: string;
}

// ─── Pattern table ───────────────────────────────────────────────────────────

interface ErrorPattern {
	test: RegExp;
	friendly: string;
	category: AgentErrorCategory;
	suggestion: string;
}

const PATTERNS: readonly ErrorPattern[] = [
	// ── Selector issues ─────────────────────────────────────────────────
	{
		test: /strict mode violation|resolved to multiple/i,
		friendly:
			'Element matched multiple results. Use a more specific selector (try text content, role, or nth-child).',
		category: 'selector',
		suggestion: 'Refine the selector with text(), role, or :nth-child() to target a single element.',
	},
	// ── Navigation timeout (must come before generic timeout) ─────────
	{
		test: /Navigation timeout/i,
		friendly:
			'Page took too long to load. Try increasing the timeout or check if the page requires authentication.',
		category: 'navigation',
		suggestion: 'Check for authentication walls or increase the navigation timeout, then retry.',
	},
	{
		test: /waiting for selector|timeout.*exceeded/i,
		friendly:
			'Element not found within timeout. Verify the selector is correct and the page has finished loading. Try getState() to check what\'s actually on the page.',
		category: 'timing',
		suggestion: 'Call getState() to inspect the current page, then retry with the correct selector.',
	},
	{
		test: /element is not visible|element is not attached/i,
		friendly:
			'Element exists but isn\'t visible. Wait for it to become visible or scroll it into view first.',
		category: 'interaction',
		suggestion: 'Use scrollTo(selector) or waitForSelector(selector) before retrying.',
	},
	{
		test: /element is outside the viewport/i,
		friendly: 'Element is off-screen. Scroll it into view before interacting.',
		category: 'interaction',
		suggestion: 'Call scrollTo(selector) to bring the element into the viewport, then retry.',
	},
	// ── Navigation / context issues ─────────────────────────────────────
	{
		test: /execution context was destroyed|frame was detached/i,
		friendly:
			'Page navigated away while executing. Re-get the element after navigation and retry.',
		category: 'navigation',
		suggestion: 'Call getState() to get the new page state, then retry with a fresh selector.',
	},
	{
		test: /net::ERR_/i,
		friendly:
			'Network error occurred. Check the URL and try again. If this persists, the site may be down or blocking requests.',
		category: 'network',
		suggestion: 'Verify the URL is reachable in a browser. Retry after a short delay.',
	},
	// ── Browser lifecycle ───────────────────────────────────────────────
	{
		test: /Target closed|Target crashed/i,
		friendly: 'Browser page was closed or crashed. Start a new session.',
		category: 'browser',
		suggestion: 'Call launch() to create a new browser session before continuing.',
	},
	{
		test: /has been closed/i,
		friendly:
			'The browser context or page has been disposed. Create a new session.',
		category: 'browser',
		suggestion: 'Call launch() to create a new browser session before continuing.',
	},
	// ── Interaction ─────────────────────────────────────────────────────
	{
		test: /Intercepted resolution/i,
		friendly:
			'Element was intercepted by another element. Try scrolling or using a different interaction method.',
		category: 'interaction',
		suggestion: 'Use scrollTo(selector) or try clicking via evaluate() to bypass the overlay.',
	},
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract a string message from any thrown value.
 */
function extractMessage(error: unknown): string {
	if (error == null) return 'Unknown error';
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return String(error);
	} catch {
		// NOSONAR — fallback for non-serialisable values
		return 'Unknown error';
	}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert any error into an AI-friendly, self-correcting {@link AgentError}.
 *
 * @param error - Anything that was thrown (Error, string, unknown).
 * @returns Structured error with remediation guidance.
 */
export function toAgentFriendlyError(error: unknown): AgentError {
	const original = extractMessage(error);

	for (const pattern of PATTERNS) {
		if (pattern.test.test(original)) {
			return {
				original,
				friendly: pattern.friendly,
				category: pattern.category,
				suggestion: pattern.suggestion,
			};
		}
	}

	// ── Fallback: unknown error ──────────────────────────────────────────
	return {
		original,
		friendly: original || 'An unknown error occurred. Inspect the page state and retry.',
		category: 'unknown',
		suggestion: 'Call getState() to inspect the current page and adjust your next action.',
	};
}

/**
 * Convenience wrapper that returns just the friendly message string.
 *
 * @param error - Anything that was thrown.
 * @returns AI-friendly error message ready to include in tool output.
 */
export function formatAgentError(error: unknown): string {
	return toAgentFriendlyError(error).friendly;
}
