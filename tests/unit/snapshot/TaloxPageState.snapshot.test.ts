/**
 * @file TaloxPageState.snapshot.test.ts
 * @description Snapshot contract tests for compactState() and diffPageState().
 * Verifies output shapes are stable via vitest toMatchSnapshot().
 *
 * Run: npx vitest run tests/unit/snapshot/TaloxPageState.snapshot.test.ts
 */
import { describe, expect, it } from "vitest";
import {
	compactState,
	diffPageState,
	type TaloxBug,
	type TaloxNode,
	type TaloxPageState,
} from "../../../src/types/index.js";

// ─── Canonical test data ─────────────────────────────────────────────────────

function makeCanonicalNodes(): TaloxNode[] {
	return [
		{
			id: "ax-0",
			role: "navigation",
			name: "Main navigation",
			boundingBox: { x: 0, y: 0, width: 1920, height: 60 },
			attributes: { id: "main-nav" },
		},
		{
			id: "ax-1",
			role: "textbox",
			name: "Search",
			description: "Search the site",
			boundingBox: { x: 100, y: 100, width: 300, height: 40 },
			attributes: { "data-testid": "search-input", placeholder: "Type here..." },
		},
		{
			id: "ax-2",
			role: "button",
			name: "Submit",
			boundingBox: { x: 420, y: 100, width: 100, height: 40 },
			attributes: { "aria-label": "Submit form" },
			children: [
				{
					id: "ax-2-0",
					role: "text",
					name: "Submit",
					boundingBox: { x: 440, y: 108, width: 60, height: 24 },
				},
			],
		},
		{
			id: "ax-3",
			role: "link",
			name: "GitHub",
			boundingBox: { x: 1600, y: 10, width: 80, height: 32 },
		},
		{
			id: "ax-4",
			role: "main",
			name: "",
			boundingBox: { x: 0, y: 60, width: 1920, height: 900 },
		},
	];
}

function makeCanonicalBugs(): TaloxBug[] {
	return [
		{
			id: "bug-001",
			type: "JS_ERROR",
			severity: "CRITICAL",
			confidence: 0.95,
			description: "Uncaught TypeError: Cannot read properties of undefined",
			reproductionSteps: ["Navigate to /dashboard", "Click #filter-btn"],
			evidence: {
				url: "https://example.com/dashboard",
				consoleLog: "TypeError: Cannot read properties of undefined ('map')",
			},
			metadata: { source: "RulesEngine" },
		},
		{
			id: "bug-002",
			type: "NETWORK_FAILURE",
			severity: "MAJOR",
			description: "POST /api/data returned 503",
			evidence: {
				url: "https://api.example.com/data",
				networkLog: "503 Service Unavailable",
			},
		},
	];
}

function makeCanonicalState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com/dashboard",
		title: "Dashboard — Example App",
		timestamp: "2026-04-23T02:00:00.000Z",
		console: {
			errors: ["TypeError: Cannot read properties of undefined"],
			warnings: ["Deprecation: document.registerElement()"],
			logs: ["App initialized", "Data loaded: 42 records"],
		},
		network: {
			failedRequests: [{ url: "https://api.example.com/data", status: 503, type: "fetch" }],
			exceptions: [{ message: "NetworkError: Load failed" }],
		},
		nodes: makeCanonicalNodes(),
		interactiveElements: [
			{
				id: "#search-input",
				tagName: "input",
				role: "search",
				text: "Search",
				boundingBox: { x: 100, y: 100, width: 300, height: 40 },
				isActionable: true,
			},
			{
				id: "#submit-btn",
				tagName: "button",
				role: "button",
				text: "Submit",
				boundingBox: { x: 420, y: 100, width: 100, height: 40 },
				isActionable: true,
			},
			{
				id: "a[href='/settings']",
				tagName: "a",
				role: "link",
				text: "Settings",
				boundingBox: { x: 1500, y: 10, width: 80, height: 32 },
			},
		],
		bugs: makeCanonicalBugs(),
		axTree: {
			id: "root",
			role: "WebArea",
			name: "Dashboard — Example App",
			boundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
			children: makeCanonicalNodes(),
		},
		timing: {
			totalMs: 142,
			axMs: 38,
			collectedAt: "2026-04-23T02:00:00.142Z",
		},
		profileId: "agent-42",
		domainHints: ["dashboard-v2", "filter-panel"],
		screenshots: {
			fullPage: "/tmp/shot-full.png",
			crops: [{ id: "crop-nav", path: "/tmp/shot-nav.png", reason: "navigation region" }],
		},
		...overrides,
	};
}

// ─── compactState snapshots ──────────────────────────────────────────────────

describe("compactState — snapshot contracts", () => {
	const state = makeCanonicalState();

	it("compactState(state, 'full') matches snapshot", () => {
		const result = compactState(state, "full");
		// 'full' returns the same reference — verify shape via snapshot
		expect(result).toMatchSnapshot();
	});

	it("compactState(state, 'agent') matches snapshot", () => {
		const result = compactState(state, "agent");

		// Verify key fields present before snapshot
		expect(result).toHaveProperty("url");
		expect(result).toHaveProperty("title");
		expect(result).toHaveProperty("timestamp");
		expect(result).toHaveProperty("interactiveElements");
		expect(result).toHaveProperty("consoleErrors");
		expect(result).toHaveProperty("bugs");
		// agent should NOT have nodes/network/console/timing
		expect((result as Record<string, unknown>).nodes).toBeUndefined();
		expect((result as Record<string, unknown>).network).toBeUndefined();
		expect((result as Record<string, unknown>).console).toBeUndefined();
		expect((result as Record<string, unknown>).timing).toBeUndefined();

		expect(result).toMatchSnapshot();
	});

	it("compactState(state, 'debug') matches snapshot", () => {
		const result = compactState(state, "debug");

		// Verify key fields present before snapshot
		expect(result).toHaveProperty("url");
		expect(result).toHaveProperty("title");
		expect(result).toHaveProperty("timestamp");
		expect(result).toHaveProperty("nodes");
		expect(result).toHaveProperty("console");
		expect(result).toHaveProperty("network");
		expect(result).toHaveProperty("bugs");
		// debug should NOT have interactiveElements/screenshots
		expect((result as Record<string, unknown>).interactiveElements).toBeUndefined();
		expect((result as Record<string, unknown>).screenshots).toBeUndefined();

		expect(result).toMatchSnapshot();
	});
});

// ─── diffPageState snapshots ─────────────────────────────────────────────────

describe("diffPageState — snapshot contracts", () => {
	it("diffPageState(prev, curr) with changes matches snapshot", () => {
		const prev = makeCanonicalState();

		const curr = makeCanonicalState({
			url: "https://example.com/settings",
			title: "Settings — Example App",
			timestamp: "2026-04-23T02:00:05.000Z",
			nodes: [
				...makeCanonicalNodes(),
				{
					id: "ax-5",
					role: "heading",
					name: "Account Settings",
					boundingBox: { x: 100, y: 200, width: 400, height: 48 },
				},
			],
			interactiveElements: [
				{
					id: "#search-input",
					tagName: "input",
					role: "search",
					text: "Search",
					boundingBox: { x: 100, y: 100, width: 300, height: 40 },
					isActionable: true,
				},
				{
					id: "#submit-btn",
					tagName: "button",
					role: "button",
					text: "Submit",
					boundingBox: { x: 420, y: 100, width: 100, height: 40 },
					isActionable: true,
				},
				{
					id: "a[href='/settings']",
					tagName: "a",
					role: "link",
					text: "Settings",
					boundingBox: { x: 1500, y: 10, width: 80, height: 32 },
				},
				{
					id: "#save-btn",
					tagName: "button",
					text: "Save",
					boundingBox: { x: 200, y: 600, width: 120, height: 40 },
				},
			],
			bugs: [
				{
					id: "bug-001",
					type: "JS_ERROR",
					severity: "CRITICAL",
					description: "Uncaught TypeError: Cannot read properties of undefined",
					evidence: {},
				},
			],
			console: {
				errors: ["TypeError: Cannot read properties of undefined", "ReferenceError: config is not defined"],
				warnings: [],
				logs: ["Settings page loaded"],
			},
			network: {
				failedRequests: [
					{ url: "https://api.example.com/data", status: 503, type: "fetch" },
					{ url: "https://cdn.example.com/font.woff2", status: 404 },
				],
			},
		});

		const diff = diffPageState(prev, curr);

		// Verify key properties
		expect(diff.urlChanged).toBe(true);
		expect(diff.titleChanged).toBe(true);
		expect(diff.fromUrl).toBe("https://example.com/dashboard");
		expect(diff.toUrl).toBe("https://example.com/settings");
		expect(diff.nodesAdded.length).toBeGreaterThan(0);
		expect(diff.bugsAdded).toHaveLength(0); // bug-001 exists in both
		expect(diff.bugsResolved).toHaveLength(1); // bug-002 resolved
		expect(diff.newConsoleErrors).toHaveLength(1);
		expect(diff.newFailedRequests).toHaveLength(1);

		expect(diff).toMatchSnapshot();
	});

	it("diffPageState(state, state) with identical states yields empty diff", () => {
		const state = makeCanonicalState();
		const diff = diffPageState(state, state);

		expect(diff.urlChanged).toBe(false);
		expect(diff.titleChanged).toBe(false);
		expect(diff.nodesAdded).toEqual([]);
		expect(diff.nodesRemoved).toEqual([]);
		expect(diff.nodesChanged).toEqual([]);
		expect(diff.interactiveAdded).toBe(0);
		expect(diff.interactiveRemoved).toBe(0);
		expect(diff.bugsAdded).toEqual([]);
		expect(diff.bugsResolved).toEqual([]);
		expect(diff.newConsoleErrors).toEqual([]);
		expect(diff.newFailedRequests).toEqual([]);
		expect(diff.elapsedMs).toBe(0);

		expect(diff).toMatchSnapshot();
	});
});
