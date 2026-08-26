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

describe("PolicyEngine amount context", () => {
	it("uses amount supplied through isActionAllowed context", () => {
		const engine = new PolicyEngine();
		configurePurchaseLimit(engine);

		expect(engine.isActionAllowed("ops", "purchase", { amount: 50 })).toBe(true);
		expect(engine.isActionAllowed("ops", "purchase", { amount: 10_000 })).toBe(false);
	});

	it("uses amount supplied through setAmountContext", () => {
		const engine = new PolicyEngine();
		configurePurchaseLimit(engine);

		engine.setAmountContext(75);
		expect(engine.isActionAllowed("ops", "purchase")).toBe(true);

		engine.setAmountContext(750);
		expect(engine.isActionAllowed("ops", "purchase")).toBe(false);
	});

	it("preserves numeric threshold semantics across comparison operators", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("qa", {
			defaultEffect: "deny",
			rules: [
				{
					action: "approve",
					effect: "allow",
					conditions: [
						{ field: "amount", operator: ">=", value: 10 },
						{ field: "amount", operator: "<", value: 20 },
					],
				},
			],
		});

		expect(engine.isActionAllowed("qa", "approve", { amount: 15 })).toBe(true);
		expect(engine.isActionAllowed("qa", "approve", { amount: 25 })).toBe(false);
	});
});
