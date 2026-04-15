import { expect } from "vitest";
import type { AgentPageState, DebugPageState, TaloxPageState } from "../../src/types/index";

export function assertValidPageState(state: unknown): asserts state is TaloxPageState {
	expect(state).toBeDefined();
	expect(typeof state).toBe("object");
	const s = state as Record<string, unknown>;

	expect(typeof s["url"], "url must be a string").toBe("string");
	expect(typeof s["title"], "title must be a string").toBe("string");
	expect(typeof s["timestamp"], "timestamp must be a string").toBe("string");

	const ts = new Date(s["timestamp"] as string);
	expect(Number.isNaN(ts.getTime()), `timestamp "${s["timestamp"]}" must be valid ISO`).toBe(false);

	const cons = s["console"] as Record<string, unknown>;
	expect(cons, "console must be an object").toBeDefined();
	expect(Array.isArray(cons["errors"]), "console.errors must be an array").toBe(true);

	const net = s["network"] as Record<string, unknown>;
	expect(net, "network must be an object").toBeDefined();
	expect(Array.isArray(net["failedRequests"]), "network.failedRequests must be an array").toBe(true);
	for (const r of net["failedRequests"] as any[]) {
		expect(typeof r["url"], "failedRequest.url must be string").toBe("string");
		expect(typeof r["status"], "failedRequest.status must be number").toBe("number");
	}

	expect(Array.isArray(s["nodes"]), "nodes must be an array").toBe(true);
	for (const n of s["nodes"] as any[]) {
		expect(typeof n["id"], "node.id must be string").toBe("string");
		expect(typeof n["role"], "node.role must be string").toBe("string");
		expect(typeof n["name"], "node.name must be string").toBe("string");
		const bb = n["boundingBox"];
		expect(bb, "node.boundingBox must exist").toBeDefined();
		expect(typeof bb["x"], "bb.x must be number").toBe("number");
		expect(typeof bb["y"], "bb.y must be number").toBe("number");
		expect(typeof bb["width"], "bb.width must be number").toBe("number");
		expect(typeof bb["height"], "bb.height must be number").toBe("number");
	}

	expect(Array.isArray(s["interactiveElements"]), "interactiveElements must be an array").toBe(true);
	for (const el of s["interactiveElements"] as any[]) {
		expect(typeof el["id"], "element.id must be string").toBe("string");
		expect(typeof el["tagName"], "element.tagName must be string").toBe("string");
		expect(el["boundingBox"], "element.boundingBox must exist").toBeDefined();
	}

	expect(Array.isArray(s["bugs"]), "bugs must be an array").toBe(true);
	for (const b of s["bugs"] as any[]) {
		expect(typeof b["id"], "bug.id must be string").toBe("string");
		expect(typeof b["type"], "bug.type must be string").toBe("string");
		expect(typeof b["severity"], "bug.severity must be string").toBe("string");
		expect(typeof b["description"], "bug.description must be string").toBe("string");
		expect(b["evidence"], "bug.evidence must exist").toBeDefined();
	}
}

export function assertValidAgentState(state: unknown): asserts state is AgentPageState {
	expect(state).toBeDefined();
	const s = state as Record<string, unknown>;
	expect(typeof s["url"], "url must be string").toBe("string");
	expect(typeof s["title"], "title must be string").toBe("string");
	expect(typeof s["timestamp"], "timestamp must be string").toBe("string");
	expect(Array.isArray(s["interactiveElements"]), "interactiveElements must be array").toBe(true);
	expect(Array.isArray(s["consoleErrors"]), "consoleErrors must be array").toBe(true);
	expect(Array.isArray(s["bugs"]), "bugs must be array").toBe(true);
	for (const b of s["bugs"] as any[]) {
		expect(typeof b["type"], "bug.type must be string").toBe("string");
		expect(typeof b["severity"], "bug.severity must be string").toBe("string");
		expect(typeof b["description"], "bug.description must be string").toBe("string");
	}
}

export function assertValidDebugState(state: unknown): asserts state is DebugPageState {
	expect(state).toBeDefined();
	const s = state as Record<string, unknown>;
	expect(typeof s["url"], "url must be string").toBe("string");
	expect(typeof s["title"], "title must be string").toBe("string");
	expect(typeof s["timestamp"], "timestamp must be string").toBe("string");
	expect(Array.isArray(s["nodes"]), "nodes must be array").toBe(true);
	expect(s["console"], "console must exist").toBeDefined();
	expect(s["network"], "network must exist").toBeDefined();
	expect(Array.isArray(s["bugs"]), "bugs must be array").toBe(true);
}

export function makeMinimalState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com/page",
		title: "Example Page",
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
	};
}

export function makeRichState(): TaloxPageState {
	return makeMinimalState({
		console: {
			errors: ["TypeError: foo is undefined"],
			warnings: ["Deprecation warning"],
			logs: ["Page loaded"],
		},
		network: {
			failedRequests: [
				{ url: "https://api.example.com/data", status: 500, type: "xhr" },
				{ url: "https://cdn.example.com/img.png", status: 404 },
			],
		},
		nodes: [
			{
				id: "n1",
				role: "button",
				name: "Submit",
				boundingBox: { x: 100, y: 200, width: 120, height: 40 },
				attributes: { disabled: false },
			},
			{
				id: "n2",
				role: "textbox",
				name: "Email",
				description: "Enter your email",
				boundingBox: { x: 100, y: 100, width: 300, height: 36 },
			},
		],
		interactiveElements: [
			{
				id: "e1",
				tagName: "button",
				role: "button",
				text: "Submit",
				boundingBox: { x: 100, y: 200, width: 120, height: 40 },
				isActionable: true,
			},
		],
		bugs: [
			{
				id: "b1",
				type: "JS_ERROR",
				severity: "MAJOR",
				description: "TypeError: foo is undefined",
				evidence: { url: "https://example.com/page", consoleLog: "TypeError: foo is undefined" },
			},
			{
				id: "b2",
				type: "NETWORK_FAILURE",
				severity: "MINOR",
				description: "API endpoint returned 500",
				evidence: { networkLog: "POST /api/data 500" },
			},
		],
		screenshots: {
			fullPage: "/tmp/screenshots/full.png",
			crops: [{ id: "c1", path: "/tmp/screenshots/crop.png", reason: "bug area" }],
		},
	});
}
