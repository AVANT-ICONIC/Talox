import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RulesEngine } from "../../src/core/RulesEngine";
import {
	clearTaloxPlugins,
	listTaloxPlugins,
	registerTaloxPlugin,
	runTaloxVisionDetectors,
	unregisterTaloxPlugin,
} from "../../src/plugins";
import type { TaloxPageState } from "../../src/types/index";

function makeState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Plugin Test",
		timestamp: new Date().toISOString(),
		console: { errors: [], warnings: [], logs: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
	};
}

beforeEach(() => clearTaloxPlugins());
afterEach(() => clearTaloxPlugins());

describe("Talox plugin registry", () => {
	it("registers, lists, and unregisters plugins in registration order", () => {
		registerTaloxPlugin({
			name: "community-a",
			version: "1.0.0",
			rules: [{ id: "missing-alt", analyze: () => [] }],
		});
		registerTaloxPlugin({
			name: "community-b",
			version: "2.1.0",
			visionDetectors: [{ id: "banner-detector", detect: () => [] }],
		});

		expect(listTaloxPlugins()).toEqual([
			{
				name: "community-a",
				version: "1.0.0",
				ruleIds: ["missing-alt"],
				visionDetectorIds: [],
			},
			{
				name: "community-b",
				version: "2.1.0",
				ruleIds: [],
				visionDetectorIds: ["banner-detector"],
			},
		]);
		expect(unregisterTaloxPlugin("community-a")).toBe(true);
		expect(unregisterTaloxPlugin("community-a")).toBe(false);
		expect(listTaloxPlugins().map((plugin) => plugin.name)).toEqual(["community-b"]);
	});

	it("rejects duplicate plugin names without replacing the original", () => {
		registerTaloxPlugin({ name: "same-name", version: "1.0.0" });
		expect(() => registerTaloxPlugin({ name: "same-name", version: "2.0.0" })).toThrow("already registered");
		expect(listTaloxPlugins()).toHaveLength(1);
		expect(listTaloxPlugins()[0].version).toBe("1.0.0");
	});

	it("rejects duplicate hook ids transactionally", () => {
		registerTaloxPlugin({
			name: "first",
			version: "1.0.0",
			rules: [{ id: "shared-rule", analyze: () => [] }],
			visionDetectors: [{ id: "shared-detector", detect: () => [] }],
		});

		expect(() =>
			registerTaloxPlugin({
				name: "second",
				version: "1.0.0",
				rules: [{ id: "unique-rule", analyze: () => [] }],
				visionDetectors: [{ id: "shared-detector", detect: () => [] }],
			}),
		).toThrow("already registered by another plugin");

		expect(listTaloxPlugins().map((plugin) => plugin.name)).toEqual(["first"]);
	});

	it("validates plugin and hook identifiers", () => {
		expect(() => registerTaloxPlugin({ name: "", version: "1.0.0" })).toThrow("non-empty string");
		expect(() =>
			registerTaloxPlugin({
				name: "bad-rule",
				version: "1.0.0",
				rules: [{ id: "has spaces", analyze: () => [] }],
			}),
		).toThrow("must start with an alphanumeric character");
	});
});

describe("community rules", () => {
	it("adds plugin findings to the normal RulesEngine pass with collision-safe ids", () => {
		registerTaloxPlugin({
			name: "a11y-pack",
			version: "3.2.1",
			rules: [
				{
					id: "button-label",
					analyze: (state) =>
						state.title === "Plugin Test"
							? [
								{
									id: "submit",
									type: "MISSING_ACCESSIBLE_LABEL",
									severity: "MAJOR",
									description: "Submit button has no accessible label.",
									evidence: { selector: "#submit" },
								},
							]
							: [],
				},
			],
		});

		const bugs = new RulesEngine().analyze(makeState());
		expect(bugs).toHaveLength(1);
		expect(bugs[0].id).toBe("plugin:a11y-pack:button-label:submit");
		expect(bugs[0].type).toBe("MISSING_ACCESSIBLE_LABEL");
		expect(bugs[0].metadata?.taloxPlugin).toEqual({ name: "a11y-pack", version: "3.2.1", ruleId: "button-label" });
	});

	it("encodes namespace components so embedded colons cannot collide", () => {
		registerTaloxPlugin({
			name: "vendor:pack",
			version: "1.0.0",
			rules: [
				{
					id: "rule:one",
					analyze: () => [
						{
							id: "finding:42",
							type: "CUSTOM",
							severity: "MINOR",
							description: "Namespaced finding",
							evidence: {},
						},
					],
				},
			],
		});

		const [bug] = new RulesEngine().analyze(makeState());
		expect(bug.id).toBe("plugin:vendor%3Apack:rule%3Aone:finding%3A42");
	});

	it("deep-freezes isolated state snapshots so one plugin cannot poison later rules", () => {
		registerTaloxPlugin({
			name: "mutator",
			version: "1.0.0",
			rules: [
				{
					id: "tries-mutation",
					analyze: (state) => {
						(state.console.errors as unknown as string[]).push("poisoned");
						return [];
					},
				},
			],
		});
		registerTaloxPlugin({
			name: "observer",
			version: "1.0.0",
			rules: [
				{
					id: "sees-clean-state",
					analyze: (state) =>
						state.console.errors.length === 0
							? [
								{
									id: "clean",
									type: "CUSTOM",
									severity: "MINOR",
									description: "State stayed clean",
									evidence: {},
								},
							]
							: [],
				},
			],
		});

		const state = makeState();
		const bugs = new RulesEngine().analyze(state);
		expect(state.console.errors).toEqual([]);
		expect(bugs.some((bug) => bug.id.endsWith(":clean"))).toBe(true);
	});

	it("rejects plugin findings with invalid confidence values", () => {
		registerTaloxPlugin({
			name: "bad-confidence",
			version: "1.0.0",
			rules: [
				{
					id: "invalid-confidence",
					analyze: () => [
						{
							id: "too-high",
							type: "CUSTOM",
							severity: "MINOR",
							description: "Invalid confidence",
							confidence: 2,
							evidence: {},
						},
						{
							id: "nan",
							type: "CUSTOM",
							severity: "MINOR",
							description: "Invalid confidence",
							confidence: Number.NaN,
							evidence: {},
						},
					],
				},
			],
		});

		expect(new RulesEngine().analyze(makeState())).toEqual([]);
	});

	it("isolates throwing and malformed plugin rules without suppressing built-in bugs", () => {
		registerTaloxPlugin({
			name: "broken-pack",
			version: "1.0.0",
			rules: [
				{
					id: "throws",
					analyze: () => {
						throw new Error("plugin exploded");
					},
				},
			],
		});
		registerTaloxPlugin({
			name: "malformed-pack",
			version: "1.0.0",
			rules: [{ id: "bad-bug", analyze: () => [{ nope: true } as never] }],
		});

		const bugs = new RulesEngine().analyze(makeState({ console: { errors: ["native failure"] } }));
		expect(bugs.filter((bug) => bug.type === "JS_ERROR")).toHaveLength(1);
		expect(bugs.some((bug) => bug.id.startsWith("plugin:"))).toBe(false);
	});
});

describe("community vision detectors", () => {
	it("runs detectors explicitly in deterministic order and isolates screenshot mutation", async () => {
		registerTaloxPlugin({
			name: "vision-a",
			version: "1.0.0",
			visionDetectors: [
				{
					id: "mutating-detector",
					detect: (screenshot) => {
						(screenshot as Buffer)[0] = 99;
						return [{ type: "A", description: "first" }];
					},
				},
			],
		});
		registerTaloxPlugin({
			name: "vision-b",
			version: "1.0.0",
			visionDetectors: [
				{
					id: "reader",
					detect: (screenshot, context) => [
						{
							type: "B",
							description: `${screenshot[0]}:${context.url}`,
							confidence: 0.9,
						},
					],
				},
			],
		});

		const source = Buffer.from([7, 8, 9]);
		const results = await runTaloxVisionDetectors(source, { url: "https://example.com" });
		expect(results.map((result) => `${result.pluginName}/${result.detectorId}`)).toEqual([
			"vision-a/mutating-detector",
			"vision-b/reader",
		]);
		expect(results[1].detections[0].description).toBe("7:https://example.com");
		expect(source[0]).toBe(7);
	});

	it("returns per-detector errors and continues after failures", async () => {
		registerTaloxPlugin({
			name: "vision-errors",
			version: "1.0.0",
			visionDetectors: [
				{
					id: "throws",
					detect: async () => {
						throw new Error("model unavailable");
					},
				},
				{ id: "survives", detect: () => [{ type: "CTA", description: "CTA obscured" }] },
			],
		});

		const results = await runTaloxVisionDetectors(Buffer.from("png"));
		expect(results).toHaveLength(2);
		expect(results[0].error).toBe("model unavailable");
		expect(results[0].detections).toEqual([]);
		expect(results[1].detections[0].type).toBe("CTA");
	});

	it("converts malformed detector output into an isolated error result", async () => {
		registerTaloxPlugin({
			name: "malformed-vision",
			version: "1.0.0",
			visionDetectors: [{ id: "bad-output", detect: () => [{ type: "", description: "missing type" }] }],
		});

		const [result] = await runTaloxVisionDetectors(Buffer.from("png"));
		expect(result.error).toContain("invalid detection list");
		expect(result.detections).toEqual([]);
	});
});
