import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../../src/core/PolicyEngine.js";

describe("PolicyEngine conditional rule fallthrough", () => {
	it("does not turn an unmatched deny rule into allow under a deny-by-default policy", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("ops", {
			defaultEffect: "deny",
			rules: [
				{
					action: "purchase",
					effect: "deny",
					conditions: [{ field: "amount", operator: ">", value: 100 }],
				},
			],
		});

		expect(engine.isActionAllowed("ops", "purchase", { amount: 50 })).toBe(false);
		expect(engine.isActionAllowed("ops", "purchase", { amount: 500 })).toBe(false);
	});

	it("falls through an unmet allow rule to the policy default", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("qa", {
			defaultEffect: "allow",
			rules: [
				{
					action: "navigate",
					effect: "allow",
					conditions: [{ field: "url", operator: "contains", value: "/admin" }],
				},
			],
		});

		expect(engine.isAllowed("qa", "https://example.com/public")).toBe(true);
	});

	it("continues to later rules when an earlier rule's conditions do not match", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("ops", {
			defaultEffect: "deny",
			rules: [
				{
					action: "transfer",
					effect: "allow",
					conditions: [{ field: "amount", operator: "<=", value: 100 }],
				},
				{
					action: "transfer",
					effect: "allow",
					conditions: [{ field: "amount", operator: ">=", value: 500 }],
				},
			],
		});

		expect(engine.isActionAllowed("ops", "transfer", { amount: 50 })).toBe(true);
		expect(engine.isActionAllowed("ops", "transfer", { amount: 600 })).toBe(true);
		expect(engine.isActionAllowed("ops", "transfer", { amount: 250 })).toBe(false);
	});

	it("still applies a conditional deny rule when its conditions match", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("qa", {
			defaultEffect: "allow",
			rules: [
				{
					action: "navigate",
					effect: "deny",
					conditions: [{ field: "url", operator: "contains", value: "/blocked" }],
				},
			],
		});

		expect(engine.isAllowed("qa", "https://example.com/blocked")).toBe(false);
		expect(engine.isAllowed("qa", "https://example.com/allowed")).toBe(true);
	});
});
