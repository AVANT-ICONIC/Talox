export interface TaloxToolParameter {
	type: string;
	description?: string;
	enum?: string[];
	properties?: Record<string, TaloxToolParameter>;
	required?: string[];
	items?: TaloxToolParameter;
}

export interface TaloxTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: {
			type: "object";
			properties: Record<string, TaloxToolParameter>;
			required?: string[];
		};
	};
}

export interface TaloxToolSet {
	tools: TaloxTool[];
	version: string;
}

/**
 * Return function-calling schemas that map directly to the public
 * {@link TaloxController} API.
 *
 * Keep this surface deliberately boring: every advertised argument must be
 * accepted by the corresponding controller method. Runtime behavior belongs
 * in controller settings, not in phantom per-call options.
 */
export function getTaloxTools(): TaloxTool[] {
	return [
		{
			type: "function",
			function: {
				name: "talox_navigate",
				description: "Navigate to a URL and return Talox's structured page state.",
				parameters: {
					type: "object",
					properties: {
						url: {
							type: "string",
							description: "Target URL to navigate to",
						},
					},
					required: ["url"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_click",
				description: "Click an element using a CSS selector and return the resulting page state.",
				parameters: {
					type: "object",
					properties: {
						selector: {
							type: "string",
							description: "CSS selector of the element to click",
						},
					},
					required: ["selector"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_type",
				description: "Type text into an element using a CSS selector and return the resulting page state.",
				parameters: {
					type: "object",
					properties: {
						selector: {
							type: "string",
							description: "CSS selector of the input element",
						},
						text: {
							type: "string",
							description: "Text to type",
						},
					},
					required: ["selector", "text"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_get_state",
				description: "Get the current Talox page state at the requested detail level.",
				parameters: {
					type: "object",
					properties: {
						variant: {
							type: "string",
							description: "State detail level. Omit for the full state.",
							enum: ["full", "agent", "debug"],
						},
					},
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_describe_page",
				description: "Return a human-readable description of the current page.",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_get_intent_state",
				description: "Return compact intent-focused page state for quick agent decisions.",
				parameters: {
					type: "object",
					properties: {},
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_screenshot",
				description: "Take a screenshot of the full page or a specific element.",
				parameters: {
					type: "object",
					properties: {
						selector: {
							type: "string",
							description: "Optional CSS selector to capture a specific element",
						},
						path: {
							type: "string",
							description: "Optional path to save the screenshot",
						},
					},
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_scroll_to",
				description: "Scroll an element into view.",
				parameters: {
					type: "object",
					properties: {
						selector: {
							type: "string",
							description: "CSS selector of the element to scroll into view",
						},
						align: {
							type: "string",
							description: "Alignment when scrolling. Defaults to center.",
							enum: ["start", "center", "end", "nearest"],
						},
					},
					required: ["selector"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_extract_table",
				description: "Extract table data as an array of JSON objects.",
				parameters: {
					type: "object",
					properties: {
						selector: {
							type: "string",
							description: "CSS selector of the table element",
						},
					},
					required: ["selector"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_wait_for_load_state",
				description: "Wait for a specific browser load state.",
				parameters: {
					type: "object",
					properties: {
						state: {
							type: "string",
							description: "Load state to wait for",
							enum: ["load", "domcontentloaded", "networkidle"],
						},
						timeout: {
							type: "number",
							description: "Timeout in milliseconds. Defaults to 30000.",
						},
					},
					required: ["state"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_set_verbosity",
				description: "Set Talox runtime verbosity from 0 (quiet) to 3 (maximum diagnostics).",
				parameters: {
					type: "object",
					properties: {
						level: {
							type: "number",
							description: "Verbosity level: 0, 1, 2, or 3",
						},
					},
					required: ["level"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_set_headed",
				description: "Switch the active Talox session between headed and headless browser mode.",
				parameters: {
					type: "object",
					properties: {
						headed: {
							type: "boolean",
							description: "True for headed mode, false for headless mode",
						},
					},
					required: ["headed"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_set_safe_mode",
				description: "Enable or disable deterministic safe mode for fast interactions without human simulation.",
				parameters: {
					type: "object",
					properties: {
						enabled: {
							type: "boolean",
							description: "Whether deterministic safe mode is enabled",
						},
					},
					required: ["enabled"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_verify_visual",
				description: "Compare the current page screenshot with a stored visual baseline.",
				parameters: {
					type: "object",
					properties: {
						baselineKey: {
							type: "string",
							description: "Identifier for the baseline screenshot",
						},
						autoSave: {
							type: "boolean",
							description: "Save the current screenshot as a baseline when one is missing",
						},
					},
					required: ["baselineKey"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_find_element",
				description: "Find an element by text content or accessible name.",
				parameters: {
					type: "object",
					properties: {
						text: {
							type: "string",
							description: "Text or accessible name to search for",
						},
						elementType: {
							type: "string",
							description: "Optional element type filter",
							enum: ["button", "link", "input", "checkbox", "radio", "menuitem", "any"],
						},
					},
					required: ["text"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "talox_evaluate",
				description: "Execute JavaScript source in the browser context and return the result.",
				parameters: {
					type: "object",
					properties: {
						script: {
							type: "string",
							description: "JavaScript source code to execute",
						},
					},
					required: ["script"],
				},
			},
		},
	];
}

export function getToolNames(): string[] {
	return getTaloxTools().map((tool) => tool.function.name);
}
