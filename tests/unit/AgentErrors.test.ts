import { describe, expect, it } from "vitest";
import { formatAgentError, toAgentFriendlyError } from "../../src/core/AgentErrors";

describe("AgentErrors", () => {
	describe("toAgentFriendlyError", () => {
		// ── Selector issues ───────────────────────────────────────────────
		it("matches strict mode violation", () => {
			const err = toAgentFriendlyError(new Error("strict mode violation: selector resolved to 3 elements"));
			expect(err.category).toBe("selector");
			expect(err.friendly).toContain("multiple results");
			expect(err.suggestion).toContain("text()");
			expect(err.original).toContain("strict mode violation");
		});

		it("matches 'resolved to multiple'", () => {
			const err = toAgentFriendlyError(new Error("selector resolved to multiple elements"));
			expect(err.category).toBe("selector");
			expect(err.friendly).toContain("multiple results");
		});

		it("matches selector timeout", () => {
			const err = toAgentFriendlyError(new Error("waiting for selector '.btn' timeout exceeded"));
			expect(err.category).toBe("timing");
			expect(err.friendly).toContain("not found within timeout");
			expect(err.suggestion).toContain("getState()");
		});

		it("matches generic timeout exceeded", () => {
			const err = toAgentFriendlyError(new Error("Timeout exceeded waiting for element"));
			expect(err.category).toBe("timing");
		});

		// ── Visibility / interaction ──────────────────────────────────────
		it("matches element is not visible", () => {
			const err = toAgentFriendlyError(new Error("element is not visible"));
			expect(err.category).toBe("interaction");
			expect(err.friendly).toContain("isn't visible");
			expect(err.suggestion).toContain("scrollTo");
		});

		it("matches element is not attached", () => {
			const err = toAgentFriendlyError(new Error("element is not attached to the DOM"));
			expect(err.category).toBe("interaction");
		});

		it("matches element outside the viewport", () => {
			const err = toAgentFriendlyError(new Error("element is outside the viewport"));
			expect(err.category).toBe("interaction");
			expect(err.friendly).toContain("off-screen");
			expect(err.suggestion).toContain("scrollTo");
		});

		// ── Navigation / context ─────────────────────────────────────────
		it("matches execution context was destroyed", () => {
			const err = toAgentFriendlyError(new Error("execution context was destroyed"));
			expect(err.category).toBe("navigation");
			expect(err.friendly).toContain("navigated away");
		});

		it("matches frame was detached", () => {
			const err = toAgentFriendlyError(new Error("frame was detached"));
			expect(err.category).toBe("navigation");
		});

		// ── Network ──────────────────────────────────────────────────────
		it("matches net::ERR_ errors", () => {
			const err = toAgentFriendlyError(new Error("net::ERR_CONNECTION_REFUSED"));
			expect(err.category).toBe("network");
			expect(err.friendly).toContain("Network error");
			expect(err.suggestion).toContain("Verify the URL");
		});

		it("matches Navigation timeout", () => {
			const err = toAgentFriendlyError(new Error("Navigation timeout of 30000ms exceeded"));
			expect(err.category).toBe("navigation");
			expect(err.friendly).toContain("too long to load");
		});

		// ── Browser lifecycle ────────────────────────────────────────────
		it("matches Target closed", () => {
			const err = toAgentFriendlyError(new Error("Target closed"));
			expect(err.category).toBe("browser");
			expect(err.friendly).toContain("closed or crashed");
			expect(err.suggestion).toContain("launch()");
		});

		it("matches Target crashed", () => {
			const err = toAgentFriendlyError(new Error("Target crashed"));
			expect(err.category).toBe("browser");
		});

		it("matches 'has been closed'", () => {
			const err = toAgentFriendlyError(new Error("The page has been closed"));
			expect(err.category).toBe("browser");
			expect(err.friendly).toContain("disposed");
		});

		// ── Interaction: intercepted ─────────────────────────────────────
		it("matches Intercepted resolution", () => {
			const err = toAgentFriendlyError(new Error("Intercepted resolution of element"));
			expect(err.category).toBe("interaction");
			expect(err.friendly).toContain("intercepted");
			expect(err.suggestion).toContain("scrollTo");
		});

		// ── Unknown / fallback ───────────────────────────────────────────
		it("returns unknown category for unmatched errors", () => {
			const err = toAgentFriendlyError(new Error("Something completely unexpected"));
			expect(err.category).toBe("unknown");
			expect(err.friendly).toBe("Something completely unexpected");
			expect(err.suggestion).toContain("getState()");
		});

		it("handles string errors", () => {
			const err = toAgentFriendlyError("A plain string error");
			expect(err.original).toBe("A plain string error");
			expect(err.category).toBe("unknown");
		});

		it("handles non-Error, non-string thrown values", () => {
			const err = toAgentFriendlyError(42);
			expect(err.original).toBe("42");
			expect(err.category).toBe("unknown");
		});

		it("handles null/undefined gracefully", () => {
			const err = toAgentFriendlyError(null);
			expect(err.category).toBe("unknown");
			expect(err.friendly).toContain("Unknown error");
		});
	});

	describe("formatAgentError", () => {
		it("returns the friendly message string", () => {
			const msg = formatAgentError(new Error("Target closed"));
			expect(msg).toContain("closed or crashed");
		});

		it("returns original message for unknown errors", () => {
			const msg = formatAgentError(new Error("Custom error xyz"));
			expect(msg).toBe("Custom error xyz");
		});

		it("handles string input", () => {
			const msg = formatAgentError("raw string");
			expect(msg).toBe("raw string");
		});
	});
});
