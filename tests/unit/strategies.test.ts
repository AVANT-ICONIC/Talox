/**
 * @file strategies.test.ts
 * @description Tests for AdaptationStrategy definitions — validates config integrity.
 */

import { describe, expect, it } from "vitest";
import { STRATEGIES } from "../../src/core/smart/strategies.js";

describe("STRATEGIES", () => {
	it("has registered strategies", () => {
		const keys = Object.keys(STRATEGIES);
		expect(keys.length).toBeGreaterThan(0);
	});

	it("every strategy has a non-empty name", () => {
		for (const [reason, strategy] of Object.entries(STRATEGIES)) {
			expect(strategy.name, `Strategy for "${reason}" missing name`).toBeTruthy();
			expect(typeof strategy.name).toBe("string");
			expect(strategy.name.length).toBeGreaterThan(0);
		}
	});

	it("every strategy name is unique", () => {
		const names = Object.values(STRATEGIES).map((s) => s.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it("every strategy has a description", () => {
		for (const [reason, strategy] of Object.entries(STRATEGIES)) {
			expect(typeof strategy.description, `Strategy "${reason}" missing description`).toBe("string");
		}
	});

	it("settingsPatch is an object when present", () => {
		for (const [reason, strategy] of Object.entries(STRATEGIES)) {
			if (strategy.settingsPatch) {
				expect(typeof strategy.settingsPatch, `Strategy "${reason}" settingsPatch not an object`).toBe("object");
				expect(strategy.settingsPatch).not.toBeNull();
			}
		}
	});

	it("sideEffect is valid when present", () => {
		const validSideEffects = ["rotate_user_agent", "enable_semantic_healing", "emit_captcha_event"];
		for (const [, strategy] of Object.entries(STRATEGIES)) {
			if (strategy.sideEffect) {
				expect(validSideEffects).toContain(strategy.sideEffect);
			}
		}
	});
});
