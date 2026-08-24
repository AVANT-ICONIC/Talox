import { describe, expect, it } from "vitest";
import { LLMPlanner } from "../../src/core/loop/Planner.js";

describe("LLMPlanner platform adapter context", () => {
	it("adds matching built-in adapter guidance to the planner message", () => {
		const planner = new LLMPlanner({ model: "test-model", apiKey: "test" });
		const message = (planner as any).buildUserMessage({
			state: {
				url: "https://shop.example/wp-admin/edit.php?post_type=product",
				title: "Products ‹ Shop — WordPress",
				interactiveElements: [],
				consoleErrors: [],
				bugs: [],
			},
			goal: { description: "Update a product", maxIterations: 5 },
			recentIterations: [],
			skillsContext: "",
		});

		expect(message).toContain("## Platform Knowledge");
		expect(message).toContain("WooCommerce Admin");
		expect(message).toContain("WordPress Admin");
		expect(message).toContain("Prefer the current Talox state whenever it disagrees");
	});

	it("adds no platform section for an unrelated site", () => {
		const planner = new LLMPlanner({ model: "test-model", apiKey: "test" });
		const message = (planner as any).buildUserMessage({
			state: {
				url: "https://example.com/dashboard",
				title: "Dashboard",
				interactiveElements: [],
				consoleErrors: [],
				bugs: [],
			},
			goal: { description: "Inspect", maxIterations: 2 },
			recentIterations: [],
			skillsContext: "",
		});

		expect(message).not.toContain("## Platform Knowledge");
	});
});
