import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../../src/core/PolicyEngine.js";

function configurePurchaseLimit(engine: PolicyEngine): void {
	engine.setPolicyForProfile("ops", {
		defaultEffect: "deny",
		rules: [
			{
				action: "purchase",
				effect: "allow",
				conditions: [{ field: "amount", operator: "<=", value: 100 }],
			},
		],
	});
}

describe("PolicyEngine scoped amount context", () => {
	it("does not let a previous per-action amount leak into the next action", () => {
		const engine = new PolicyEngine();
		configurePurchaseLimit(engine);

		expect(engine.isActionAllowed("ops", "purchase", { amount: 50 })).toBe(true);
		expect(engine.isActionAllowed("ops", "purchase")).toBe(false);
	});

	it("fails closed when an amount condition has no amount context", () => {
		const engine = new PolicyEngine();
		configurePurchaseLimit(engine);

		expect(engine.isActionAllowed("ops", "purchase")).toBe(false);
	});

	it("denies missing amount even when the policy default is allow", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("ops", {
			defaultEffect: "allow",
			rules: [
				{
					action: "purchase",
					effect: "deny",
					conditions: [{ field: "amount", operator: ">=", value: 0 }],
				},
			],
		});

		expect(engine.isActionAllowed("ops", "purchase")).toBe(false);
		expect(engine.isActionAllowed("ops", "purchase", { amount: 25 })).toBe(false);
	});

	it("restores an explicit persistent amount after a scoped override", () => {
		const engine = new PolicyEngine();
		configurePurchaseLimit(engine);
		engine.setAmountContext(500);

		expect(engine.isActionAllowed("ops", "purchase")).toBe(false);
		expect(engine.isActionAllowed("ops", "purchase", { amount: 50 })).toBe(true);
		expect(engine.isActionAllowed("ops", "purchase")).toBe(false);
	});

	it("restores an explicitly allowed amount after a denied scoped override", () => {
		const engine = new PolicyEngine();
		configurePurchaseLimit(engine);
		engine.setAmountContext(50);

		expect(engine.isActionAllowed("ops", "purchase")).toBe(true);
		expect(engine.isActionAllowed("ops", "purchase", { amount: 500 })).toBe(false);
		expect(engine.isActionAllowed("ops", "purchase")).toBe(true);
	});

	it("clears persistent amount context when policies are reset", () => {
		const engine = new PolicyEngine();
		configurePurchaseLimit(engine);
		engine.setAmountContext(50);
		expect(engine.isActionAllowed("ops", "purchase")).toBe(true);

		engine.clearPolicies();
		configurePurchaseLimit(engine);

		expect(engine.isActionAllowed("ops", "purchase")).toBe(false);
	});
});
