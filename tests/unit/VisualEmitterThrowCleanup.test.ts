import { afterEach, describe, expect, it, vi } from "vitest";
import * as VisualReasoner from "../../src/core/VisualReasoner.js";

afterEach(() => {
	vi.useRealTimers();
	VisualReasoner.setVisualEmitter(null);
	VisualReasoner.setVisualReasoner(null);
});

describe("visual emitter failure cleanup", () => {
	it("removes scoped pending state before rethrowing an emitter error", async () => {
		const owner = {};
		const error = new Error("emitter boom");
		VisualReasoner.setScopedVisualScope(owner, {
			emitter: () => {
				throw error;
			},
		});

		await expect(VisualReasoner.askVisualScoped(owner, Buffer.from("image"), "question", 10_000)).rejects.toBe(error);
		expect(VisualReasoner.cancelScopedVisualQuestions(owner)).toBe(0);
	});

	it("does not invoke the fallback later after emitter failure cleanup", async () => {
		vi.useFakeTimers();
		const owner = {};
		const reasoner = {
			name: "should-not-run",
			analyze: vi.fn(async () => "late-fallback"),
		};
		VisualReasoner.setScopedVisualScope(owner, {
			emitter: () => {
				throw new Error("dispatch failed");
			},
			reasoner,
		});

		await expect(VisualReasoner.askVisualScoped(owner, Buffer.from("image"), "question", 10_000)).rejects.toThrow(
			"dispatch failed",
		);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(reasoner.analyze).not.toHaveBeenCalled();
		expect(VisualReasoner.cancelScopedVisualQuestions(owner)).toBe(0);
	});
});
