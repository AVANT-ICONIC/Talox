/**
 * @file commandHandler.test.ts
 * @description Unit tests for daemon commandHandler — validates dispatch and param validation.
 */

import { describe, expect, it, vi } from "vitest";
import type { TaloxController } from "../../src/core/controller/TaloxController.js";
import { generateSessionId, handleCommand } from "../../src/core/daemon/commandHandler.js";
import type { DaemonCommand, DaemonResponse } from "../../src/core/daemon/TaloxDaemon.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockController(overrides: Partial<TaloxController> = {}): TaloxController {
	return {
		navigate: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Example" }),
		click: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Clicked" }),
		type: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Typed" }),
		getState: vi.fn().mockResolvedValue({ url: "https://example.com", title: "State" }),
		screenshot: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Screenshot" }),
		...overrides,
	} as unknown as TaloxController;
}

function cmd(action: string, params?: Record<string, string>): DaemonCommand {
	return { id: "test-1", action, params };
}

// ─── handleCommand dispatch ───────────────────────────────────────────────────

describe("handleCommand", () => {
	it("dispatches navigate action", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("navigate", { url: "https://x.com" }));
		expect(res.success).toBe(true);
		expect(res.data).toEqual({ url: "https://example.com", title: "Example" });
		expect(ctrl.navigate).toHaveBeenCalledWith("https://x.com");
	});

	it("dispatches click action", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("click", { selector: "#btn" }));
		expect(res.success).toBe(true);
		expect(ctrl.click).toHaveBeenCalledWith("#btn");
	});

	it("dispatches type action", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("type", { selector: "input", text: "hello" }));
		expect(res.success).toBe(true);
		expect(ctrl.type).toHaveBeenCalledWith("input", "hello");
	});

	it("dispatches getState action", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("getState"));
		expect(res.success).toBe(true);
		expect(ctrl.getState).toHaveBeenCalled();
	});

	it("dispatches screenshot action", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("screenshot"));
		expect(res.success).toBe(true);
		expect(ctrl.screenshot).toHaveBeenCalledWith(undefined);
	});

	it("returns error for unknown action", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("unknownAction"));
		expect(res.success).toBe(false);
		expect(res.error).toContain("Unknown action");
	});

	it("catches thrown errors and returns error response", async () => {
		const ctrl = mockController({
			navigate: vi.fn().mockRejectedValue(new Error("BOOM")),
		});
		const res = await handleCommand(ctrl, cmd("navigate", { url: "https://x.com" }));
		expect(res.success).toBe(false);
		expect(res.error).toBe("BOOM");
	});
});

// ─── Param validation ─────────────────────────────────────────────────────────

describe("param validation", () => {
	it("navigate rejects missing url", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("navigate"));
		expect(res.success).toBe(false);
		expect(res.error).toContain("url");
	});

	it("navigate rejects empty url", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("navigate", { url: "" }));
		expect(res.success).toBe(false);
	});

	it("navigate rejects non-string url", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, { id: "x", action: "navigate", params: { url: 123 as unknown as string } });
		expect(res.success).toBe(false);
	});

	it("click rejects missing selector", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("click"));
		expect(res.success).toBe(false);
		expect(res.error).toContain("selector");
	});

	it("click rejects empty selector", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("click", { selector: "" }));
		expect(res.success).toBe(false);
	});

	it("type rejects missing selector", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("type", { text: "hi" }));
		expect(res.success).toBe(false);
		expect(res.error).toContain("selector");
	});

	it("type rejects missing text", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, cmd("type", { selector: "input" }));
		expect(res.success).toBe(false);
		expect(res.error).toContain("text");
	});

	it("type rejects non-string text", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, {
			id: "x",
			action: "type",
			params: { selector: "input", text: 123 as unknown as string },
		});
		expect(res.success).toBe(false);
	});
});

// ─── Screenshot response formatting ───────────────────────────────────────────

describe("screenshot", () => {
	it("passes selector through to controller", async () => {
		const ctrl = mockController();
		await handleCommand(ctrl, cmd("screenshot", { selector: ".main" }));
		expect(ctrl.screenshot).toHaveBeenCalledWith({ selector: ".main" });
	});

	it("omits empty selector from options", async () => {
		const ctrl = mockController();
		await handleCommand(ctrl, cmd("screenshot", { selector: "" }));
		expect(ctrl.screenshot).toHaveBeenCalledWith(undefined);
	});

	it("handles Buffer response (base64 encoding)", async () => {
		const buf = Buffer.from("fake-png-data");
		const ctrl = mockController({ screenshot: vi.fn().mockResolvedValue(buf) });
		const res = await handleCommand(ctrl, cmd("screenshot"));
		expect(res.success).toBe(true);
		expect(res.data).toEqual({ encoding: "base64", data: buf.toString("base64") });
	});

	it("handles string response (path)", async () => {
		const ctrl = mockController({ screenshot: vi.fn().mockResolvedValue("/tmp/shot.png") });
		const res = await handleCommand(ctrl, cmd("screenshot"));
		expect(res.success).toBe(true);
		expect(res.data).toEqual({ path: "/tmp/shot.png" });
	});
});

// ─── Response helpers ─────────────────────────────────────────────────────────

describe("response format", () => {
	it("success response includes id and success: true", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, { id: "abc-123", action: "getState", params: {} });
		expect(res.id).toBe("abc-123");
		expect(res.success).toBe(true);
	});

	it("error response includes id, success: false, and error message", async () => {
		const ctrl = mockController();
		const res = await handleCommand(ctrl, { id: "err-1", action: "navigate", params: {} });
		expect(res.id).toBe("err-1");
		expect(res.success).toBe(false);
		expect(res.error).toBeTruthy();
	});

	it("error response from thrown non-Error uses String()", async () => {
		const ctrl = mockController({ navigate: vi.fn().mockRejectedValue("plain string error") });
		const res = await handleCommand(ctrl, cmd("navigate", { url: "https://x.com" }));
		expect(res.success).toBe(false);
		expect(res.error).toBe("plain string error");
	});
});

// ─── generateSessionId ────────────────────────────────────────────────────────

describe("generateSessionId", () => {
	it("returns a string", () => {
		expect(typeof generateSessionId()).toBe("string");
	});

	it("returns unique values", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
		expect(ids.size).toBe(100);
	});

	it("matches UUID v4 format", () => {
		const uuid = generateSessionId();
		expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});
});
