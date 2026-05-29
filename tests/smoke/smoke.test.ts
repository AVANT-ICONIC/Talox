/**
 * @file smoke.test.ts
 * @description Smoke test that verifies the built dist/index.js exports are intact
 * and TaloxController can be instantiated without throwing.
 *
 * No browser launch — constructor only.
 * Run: npx vitest run tests/smoke/smoke.test.ts
 */
import { describe, expect, it } from "vitest";
import { SelfHealingSelector } from "../../dist/core/SelfHealingSelector.js";
// SemanticMapper and SelfHealingSelector are not re-exported from the barrel —
// import directly from their dist modules to verify the build artifacts exist.
import { SemanticMapper } from "../../dist/core/SemanticMapper.js";
// Import from the *built* output to verify the dist bundle is valid
import {
	AutonomousLoop,
	BrowserManager,
	compactState,
	diffPageState,
	EventBus,
	FingerprintGenerator,
	LLMPlanner,
	PRESETS,
	SkillLoader,
	SkillWriter,
	TaloxController,
} from "../../dist/index.js";
import type { TaloxPageState } from "../../dist/types/index.js";

// ─── Export existence checks ─────────────────────────────────────────────────

describe("smoke — dist/index.js exports", () => {
	it("exports TaloxController as a constructable class", () => {
		expect(TaloxController).toBeDefined();
		expect(typeof TaloxController).toBe("function");
	});

	it("exports AutonomousLoop as a constructable class", () => {
		expect(AutonomousLoop).toBeDefined();
		expect(typeof AutonomousLoop).toBe("function");
	});

	it("exports LLMPlanner as a constructable class", () => {
		expect(LLMPlanner).toBeDefined();
		expect(typeof LLMPlanner).toBe("function");
	});

	it("exports SkillLoader as a constructable class", () => {
		expect(SkillLoader).toBeDefined();
		expect(typeof SkillLoader).toBe("function");
	});

	it("exports SkillWriter as a constructable class", () => {
		expect(SkillWriter).toBeDefined();
		expect(typeof SkillWriter).toBe("function");
	});

	it("exports PRESETS object with known keys", () => {
		expect(PRESETS).toBeDefined();
		expect(typeof PRESETS).toBe("object");
		expect(PRESETS).toHaveProperty("ops");
		expect(PRESETS).toHaveProperty("qa");
		expect(PRESETS).toHaveProperty("observe");
		expect(PRESETS).toHaveProperty("research");
	});

	it("exports FingerprintGenerator as a constructable class", () => {
		expect(FingerprintGenerator).toBeDefined();
		expect(typeof FingerprintGenerator).toBe("function");
	});

	it("exports BrowserManager as a constructable class", () => {
		expect(BrowserManager).toBeDefined();
		expect(typeof BrowserManager).toBe("function");
	});

	it("exports EventBus as a constructable class", () => {
		expect(EventBus).toBeDefined();
		expect(typeof EventBus).toBe("function");
	});

	it("exports SemanticMapper as a constructable class", () => {
		expect(SemanticMapper).toBeDefined();
		expect(typeof SemanticMapper).toBe("function");
	});

	it("exports SelfHealingSelector as a constructable class", () => {
		expect(SelfHealingSelector).toBeDefined();
		expect(typeof SelfHealingSelector).toBe("function");
	});

	it("exports compactState as a function", () => {
		expect(compactState).toBeDefined();
		expect(typeof compactState).toBe("function");
	});

	it("exports diffPageState as a function", () => {
		expect(diffPageState).toBeDefined();
		expect(typeof diffPageState).toBe("function");
	});
});

// ─── TaloxController instantiation ───────────────────────────────────────────

describe("smoke — TaloxController instantiation", () => {
	it("constructor does not throw with no arguments", () => {
		expect(() => new TaloxController()).not.toThrow();
	});

	it("constructor does not throw with a baseDir string", () => {
		expect(() => new TaloxController(".")).not.toThrow();
	});

	it("constructor does not throw with config object", () => {
		expect(() => new TaloxController({ settings: { verbosity: 0 } })).not.toThrow();
	});

	it("constructor does not throw with baseDir + config", () => {
		expect(() => new TaloxController(".", { settings: { verbosity: 0 } })).not.toThrow();
	});
});

// ─── TaloxController public method surface ────────────────────────────────────

describe("smoke — TaloxController public methods exist", () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const proto = TaloxController.prototype as any;

	const publicMethods = [
		"launch",
		"stop",
		"navigate",
		"getState",
		"click",
		"type",
		"scrollTo",
		"mouseMove",
		"screenshot",
		"waitForSelector",
		"waitForNavigation",
		"waitForLoadState",
		"waitForTimeout",
		"fidget",
		"think",
		"setVerbosity",
		"getVerbosity",
		"getDebugSnapshot",
		"isHeaded",
		"getSettings",
		"getChallengeState",
		"resolveChallenge",
		"requestHumanTakeover",
		"resumeAgent",
		"getTakeoverState",
		"getTakeoverHistory",
		"setSafeMode",
		"isSafeMode",
		"findElement",
		"extractTable",
		"annotatedScreenshot",
		"generateBehavioralDNA",
		"setBehavioralDNA",
		"getBehavioralDNA",
		"setAttentionFrame",
		"clearAttentionFrame",
		"getAttentionFrame",
		"evaluate",
		"on",
		"off",
	];

	for (const method of publicMethods) {
		it(`${method} exists on prototype`, () => {
			expect(typeof proto[method]).toBe("function");
		});
	}
});

// ─── Supporting classes instantiate cleanly ───────────────────────────────────

describe("smoke — supporting classes instantiate", () => {
	it("FingerprintGenerator() generates a profile", () => {
		const gen = new FingerprintGenerator();
		const fp = gen.generate();
		expect(fp).toBeDefined();
		expect(fp.id).toBeTruthy();
		expect(fp.os).toBeTruthy();
	});

	it("SemanticMapper() can map an empty array", () => {
		const mapper = new SemanticMapper();
		const result = mapper.mapNodes([]);
		expect(result).toEqual([]);
	});

	it("SelfHealingSelector() can record and retrieve", () => {
		const healer = new SelfHealingSelector();
		const node = {
			id: "test",
			role: "button",
			name: "Click me",
			boundingBox: { x: 0, y: 0, width: 100, height: 40 },
		};
		healer.recordSuccess("#btn", node);
		expect(healer.getSuccessStates("#btn")).toHaveLength(1);
	});

	it("compactState works on a minimal state", () => {
		const state: TaloxPageState = {
			url: "https://example.com",
			title: "Test",
			timestamp: new Date().toISOString(),
			console: { errors: [] },
			network: { failedRequests: [] },
			nodes: [],
			interactiveElements: [],
			bugs: [],
		};
		const full = compactState(state, "full");
		expect(full).toBe(state);

		const agent = compactState(state, "agent");
		expect(agent.url).toBe("https://example.com");

		const debug = compactState(state, "debug");
		expect(debug.url).toBe("https://example.com");
	});
});
