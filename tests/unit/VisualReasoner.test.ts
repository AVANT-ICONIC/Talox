/**
 * @file VisualReasoner.test.ts
 * @description Tests for VisualReasoner — event-based + fallback.
 */

import { describe, expect, it } from "vitest";
import {
	setVisualReasoner,
	getVisualReasoner,
	askVisual,
	resolveVisual,
	setVisualEmitter,
	setScreenshotFormat,
	getScreenshotFormat,
	type VisualReasoner,
} from "../../src/core/VisualReasoner.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fakeScreenshot = Buffer.from("fake-png-data");

// ─── Registry ─────────────────────────────────────────────────────────────────

describe("VisualReasoner registry", () => {
	it("starts null", () => {
		setVisualReasoner(null);
		expect(getVisualReasoner()).toBeNull();
	});

	it("sets and returns reasoner", () => {
		const r: VisualReasoner = { name: "test", analyze: async () => "answer" };
		setVisualReasoner(r);
		expect(getVisualReasoner()?.name).toBe("test");
	});

	it("clears with null", () => {
		const r: VisualReasoner = { name: "test", analyze: async () => "answer" };
		setVisualReasoner(r);
		setVisualReasoner(null);
		expect(getVisualReasoner()).toBeNull();
	});
});

// ─── askVisual (fallback path) ────────────────────────────────────────────────

describe("askVisual fallback", () => {
	it("returns null when no emitter and no reasoner", async () => {
		setVisualEmitter(null);
		setVisualReasoner(null);
		const result = await askVisual(fakeScreenshot, "What?", 100);
		expect(result).toBeNull();
	});

	it("returns answer from fallback reasoner when emitter is null", async () => {
		setVisualEmitter(null);
		const r: VisualReasoner = {
			name: "mock",
			analyze: async (_s, q) => `Answer: ${q}`,
		};
		setVisualReasoner(r);
		const result = await askVisual(fakeScreenshot, "What is the title?", 100);
		expect(result).toBe("Answer: What is the title?");
	});

	it("returns null when fallback reasoner throws", async () => {
		setVisualEmitter(null);
		const r: VisualReasoner = {
			name: "crashy",
			analyze: async () => {
				throw new Error("VLM offline");
			},
		};
		setVisualReasoner(r);
		const result = await askVisual(fakeScreenshot, "anything", 100);
		expect(result).toBeNull();
	});

	it("returns null when fallback reasoner returns null", async () => {
		setVisualEmitter(null);
		setVisualReasoner({ name: "unsure", analyze: async () => null });
		const result = await askVisual(fakeScreenshot, "anything", 100);
		expect(result).toBeNull();
	});
});

// ─── Event-based askVisual ────────────────────────────────────────────────────

describe("askVisual with emitter", () => {
	it("prefers agent response over fallback", async () => {
		setVisualReasoner({ name: "fallback", analyze: async () => "from-fallback" });

		// Set up an emitter that auto-resolves via resolveVisual
		let emittedId = "";
		setVisualEmitter((payload) => {
			emittedId = payload.id;
			// Simulate agent answering immediately
			setTimeout(() => resolveVisual(payload.id, "from-agent"), 10);
		});

		const result = await askVisual(fakeScreenshot, "What?", 5000);
		expect(result).toBe("from-agent");
	});

	it("falls back when agent does not respond in time", async () => {
		setVisualReasoner({ name: "fallback", analyze: async () => "fallback-answer" });
		setVisualEmitter(() => {
			// Agent receives event but never calls resolveVisual
		});

		const result = await askVisual(fakeScreenshot, "What?", 50);
		expect(result).toBe("fallback-answer");
	});
});

// ─── resolveVisual ────────────────────────────────────────────────────────────

describe("resolveVisual", () => {
	it("is a no-op for unknown IDs", () => {
		// Should not throw
		resolveVisual("nonexistent-id", "answer");
	});
});

// ─── Screenshot format ────────────────────────────────────────────────────────

describe("screenshot format", () => {
	it("defaults to base64", () => {
		expect(getScreenshotFormat()).toBe("base64");
	});

	it("can be changed to buffer", () => {
		setScreenshotFormat("buffer");
		expect(getScreenshotFormat()).toBe("buffer");
		setScreenshotFormat("base64"); // reset
	});
});
