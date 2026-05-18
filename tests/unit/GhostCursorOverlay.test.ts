/**
 * @file GhostCursorOverlay.test.ts
 * @description Unit tests for GhostCursorOverlay — cursor injection, callbacks, and ripple effects.
 */

import { describe, expect, it, vi } from "vitest";
import { GhostCursorOverlay, type GhostCursorOptions } from "../../src/core/GhostCursorOverlay.js";
import type { Page } from "playwright-core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockPage(): Page {
	return {
		exposeFunction: vi.fn().mockResolvedValue(undefined),
		addInitScript: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockResolvedValue(undefined),
	} as unknown as Page;
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("GhostCursorOverlay constructor", () => {
	it("creates with default options when none provided", async () => {
		const overlay = new GhostCursorOverlay();
		// Defaults should be set — verify by reading private options via inject
		const page = mockPage();
		await overlay.inject(page);
		expect(page.exposeFunction).toHaveBeenCalled();
		const fn = page.addInitScript as ReturnType<typeof vi.fn>;
		const script = fn.mock.calls[0][0] as string;
		expect(script).toContain("cyan");
		expect(script).toContain("'8'"); // default radius
	});

	it("merges partial options with defaults", async () => {
		const overlay = new GhostCursorOverlay({ color: "red", radius: 20 });
		const page = mockPage();
		await overlay.inject(page);
		const fn = page.addInitScript as ReturnType<typeof vi.fn>;
		const script = fn.mock.calls[0][0] as string;
		expect(script).toContain("red");
		expect(script).toContain("'20'");
	});

	it("accepts all custom options", async () => {
		const opts: Partial<GhostCursorOptions> = {
			color: "lime",
			radius: 5,
			trailLength: 3,
			trailOpacity: 0.8,
			glowRadius: 10,
			clickRippleDuration: 200,
		};
		const overlay = new GhostCursorOverlay(opts);
		const page = mockPage();
		await overlay.inject(page);
		const fn = page.addInitScript as ReturnType<typeof vi.fn>;
		const script = fn.mock.calls[0][0] as string;
		expect(script).toContain("lime");
		expect(script).toContain("'5'");
		expect(script).toContain("3"); // trail length (embedded as number literal)
		expect(script).toContain("0.8");
		expect(script).toContain("'10'");
		expect(script).toContain("200");
	});
});

// ─── inject ───────────────────────────────────────────────────────────────────

describe("inject", () => {
	it("calls exposeFunction and addInitScript on first inject", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.inject(page);
		expect(page.exposeFunction).toHaveBeenCalledTimes(1);
		expect(page.addInitScript).toHaveBeenCalledTimes(1);
	});

	it("is idempotent — second inject is a no-op", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.inject(page);
		await overlay.inject(page);
		expect(page.exposeFunction).toHaveBeenCalledTimes(1);
		expect(page.addInitScript).toHaveBeenCalledTimes(1);
	});

	it("injects separately for different pages", async () => {
		const overlay = new GhostCursorOverlay();
		const page1 = mockPage();
		const page2 = mockPage();
		await overlay.inject(page1);
		await overlay.inject(page2);
		expect(page1.exposeFunction).toHaveBeenCalledTimes(1);
		expect(page2.exposeFunction).toHaveBeenCalledTimes(1);
	});

	it("exposes __taloxMoveCursor__ function", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.inject(page);
		expect(page.exposeFunction).toHaveBeenCalledWith("__taloxMoveCursor__", expect.any(Function));
	});

	it("init script includes SVG overlay setup", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.inject(page);
		const script = (page.addInitScript as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(script).toContain("talox-cursor-overlay");
		expect(script).toContain("__taloxUpdateCursor__");
		expect(script).toContain("MutationObserver");
	});
});

// ─── createCallback ───────────────────────────────────────────────────────────

describe("createCallback", () => {
	it("returns a function", () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		const cb = overlay.createCallback(page);
		expect(typeof cb).toBe("function");
	});

	it("calls page.evaluate with the cursor position", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		const cb = overlay.createCallback(page);
		await cb(100, 200);
		expect(page.evaluate).toHaveBeenCalledTimes(1);
		const [fn, args] = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(args).toEqual([100, 200]);
	});

	it("evaluate function passes coordinates to __taloxUpdateCursor__", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		const cb = overlay.createCallback(page);
		await cb(50, 75);
		// Verify the evaluate function body calls window.__taloxUpdateCursor__(px, py, false)
		const [fn] = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(fn.toString()).toContain("__taloxUpdateCursor__");
	});

	it("silently catches errors (page closed during callback)", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		(page.evaluate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Page closed"));
		const cb = overlay.createCallback(page);
		await expect(cb(10, 20)).resolves.toBeUndefined();
	});
});

// ─── clickRipple ──────────────────────────────────────────────────────────────

describe("clickRipple", () => {
	it("calls page.evaluate with position", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.clickRipple(page, 300, 400);
		expect(page.evaluate).toHaveBeenCalledTimes(1);
		const [, args] = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(args).toEqual([300, 400]);
	});

	it("passes clicked=true to __taloxUpdateCursor__", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.clickRipple(page, 10, 20);
		const [fn] = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
		const fnStr = fn.toString();
		expect(fnStr).toContain("__taloxUpdateCursor__");
		expect(fnStr).toContain("true"); // clicked parameter
	});

	it("silently catches errors (page navigated away)", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		(page.evaluate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Execution context destroyed"));
		await expect(overlay.clickRipple(page, 0, 0)).resolves.toBeUndefined();
	});
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("negative coordinates pass through", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.clickRipple(page, -10, -20);
		const [, args] = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(args).toEqual([-10, -20]);
	});

	it("zero coordinates pass through", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		const cb = overlay.createCallback(page);
		await cb(0, 0);
		const [, args] = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(args).toEqual([0, 0]);
	});

	it("large coordinates pass through", async () => {
		const overlay = new GhostCursorOverlay();
		const page = mockPage();
		await overlay.clickRipple(page, 99999, 88888);
		const [, args] = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(args).toEqual([99999, 88888]);
	});
});
