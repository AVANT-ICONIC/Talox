import { describe, expect, it } from "vitest";
import { getTaloxTools, getToolNames } from "../../src/core/TaloxTools";

const EXPECTED_TOOL_NAMES = [
	"talox_navigate",
	"talox_click",
	"talox_type",
	"talox_get_state",
	"talox_describe_page",
	"talox_get_intent_state",
	"talox_screenshot",
	"talox_scroll_to",
	"talox_extract_table",
	"talox_wait_for_load_state",
	"talox_set_verbosity",
	"talox_set_headed",
	"talox_set_safe_mode",
	"talox_verify_visual",
	"talox_find_element",
	"talox_evaluate",
] as const;

describe("TaloxTools", () => {
	describe("getTaloxTools", () => {
		it("returns the v9 controller-aligned tool surface", () => {
			const tools = getTaloxTools();
			expect(tools.map((tool) => tool.function.name)).toEqual(EXPECTED_TOOL_NAMES);
		});

		it('every tool has type "function" and complete metadata', () => {
			for (const tool of getTaloxTools()) {
				expect(tool.type).toBe("function");
				expect(typeof tool.function.name).toBe("string");
				expect(typeof tool.function.description).toBe("string");
				expect(tool.function.parameters.type).toBe("object");
				expect(tool.function.parameters.properties).toBeDefined();
			}
		});

		it("does not advertise removed legacy mode controls", () => {
			const tools = getTaloxTools();
			const names = tools.map((tool) => tool.function.name);
			const navigate = tools.find((tool) => tool.function.name === "talox_navigate")!;

			expect(names).not.toContain("talox_set_mode");
			expect(navigate.function.parameters.properties).toEqual({
				url: {
					type: "string",
					description: "Target URL to navigate to",
				},
			});
		});

		it("does not advertise phantom click/type arguments", () => {
			const tools = getTaloxTools();
			const click = tools.find((tool) => tool.function.name === "talox_click")!;
			const type = tools.find((tool) => tool.function.name === "talox_type")!;

			expect(Object.keys(click.function.parameters.properties)).toEqual(["selector"]);
			expect(Object.keys(type.function.parameters.properties)).toEqual(["selector", "text"]);
			expect(click.function.parameters.required).toEqual(["selector"]);
			expect(type.function.parameters.required).toEqual(["selector", "text"]);
		});

		it("maps state detail to TaloxController.getState variants", () => {
			const state = getTaloxTools().find((tool) => tool.function.name === "talox_get_state")!;
			const variant = state.function.parameters.properties["variant"];

			expect(variant.type).toBe("string");
			expect(variant.enum).toEqual(["full", "agent", "debug"]);
			expect(state.function.parameters.properties["perceptionDepth"]).toBeUndefined();
		});

		it("exposes current runtime controls instead of mode switching", () => {
			const tools = getTaloxTools();
			const verbosity = tools.find((tool) => tool.function.name === "talox_set_verbosity")!;
			const headed = tools.find((tool) => tool.function.name === "talox_set_headed")!;
			const safeMode = tools.find((tool) => tool.function.name === "talox_set_safe_mode")!;

			expect(verbosity.function.parameters.properties["level"].type).toBe("number");
			expect(verbosity.function.parameters.required).toEqual(["level"]);
			expect(headed.function.parameters.properties["headed"].type).toBe("boolean");
			expect(headed.function.parameters.required).toEqual(["headed"]);
			expect(safeMode.function.parameters.properties["enabled"].type).toBe("boolean");
			expect(safeMode.function.parameters.required).toEqual(["enabled"]);
		});

		it("keeps load-state and element-type enums aligned with controller methods", () => {
			const tools = getTaloxTools();
			const wait = tools.find((tool) => tool.function.name === "talox_wait_for_load_state")!;
			const find = tools.find((tool) => tool.function.name === "talox_find_element")!;

			expect(wait.function.parameters.properties["state"].enum).toEqual([
				"load",
				"domcontentloaded",
				"networkidle",
			]);
			expect(find.function.parameters.properties["elementType"].enum).toEqual([
				"button",
				"link",
				"input",
				"checkbox",
				"radio",
				"menuitem",
				"any",
			]);
		});

		it("declares required arguments for direct controller calls", () => {
			const tools = getTaloxTools();
			const requiredByTool: Record<string, string[]> = {
				talox_navigate: ["url"],
				talox_click: ["selector"],
				talox_type: ["selector", "text"],
				talox_scroll_to: ["selector"],
				talox_extract_table: ["selector"],
				talox_wait_for_load_state: ["state"],
				talox_set_verbosity: ["level"],
				talox_set_headed: ["headed"],
				talox_set_safe_mode: ["enabled"],
				talox_verify_visual: ["baselineKey"],
				talox_find_element: ["text"],
				talox_evaluate: ["script"],
			};

			for (const [name, required] of Object.entries(requiredByTool)) {
				const tool = tools.find((candidate) => candidate.function.name === name);
				expect(tool?.function.parameters.required).toEqual(required);
			}
		});

		it("returns new arrays on each call", () => {
			const first = getTaloxTools();
			const second = getTaloxTools();
			expect(first).not.toBe(second);
		});
	});

	describe("getToolNames", () => {
		it("matches getTaloxTools exactly", () => {
			expect(getToolNames()).toEqual(EXPECTED_TOOL_NAMES);
		});
	});
});
