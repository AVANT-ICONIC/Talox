/**
 * @file VisualReasoner.test.ts
 * @description Tests for VisualReasoner registry and askVisual.
 */

import { describe, expect, it } from "vitest";
import { setVisualReasoner, getVisualReasoner, askVisual, type VisualReasoner } from "../../src/core/VisualReasoner.js";

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

// ─── askVisual ────────────────────────────────────────────────────────────────

describe("askVisual", () => {
	const fakeScreenshot = Buffer.from("fake-png-data");

	it("returns null when no reasoner registered", async () => {
		setVisualReasoner(null);
		const result = await askVisual(fakeScreenshot, "What is this?");
		expect(result).toBeNull();
	});

	it("returns answer from registered reasoner", async () => {
		const r: VisualReasoner = {
			name: "mock-vlm",
			analyze: async (_screenshot, question) => `Answer to: ${question}`,
		};
		setVisualReasoner(r);
		const result = await askVisual(fakeScreenshot, "What is the title?");
		expect(result).toBe("Answer to: What is the title?");
	});

	it("returns null when reasoner throws", async () => {
		const r: VisualReasoner = {
			name: "crashy",
			analyze: async () => {
				throw new Error("VLM offline");
			},
		};
		setVisualReasoner(r);
		const result = await askVisual(fakeScreenshot, "anything");
		expect(result).toBeNull();
	});

	it("returns null when reasoner returns null", async () => {
		const r: VisualReasoner = {
			name: "unsure",
			analyze: async () => null,
		};
		setVisualReasoner(r);
		const result = await askVisual(fakeScreenshot, "anything");
		expect(result).toBeNull();
	});
});
