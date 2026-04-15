import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERCEPTION_PRESETS, PerceptionStack } from "../../src/core/PerceptionStack";
import type { TaloxPageState } from "../../src/types/index";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBaseState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Example",
		timestamp: new Date().toISOString(),
		console: { errors: ["TypeError: x is not a function"] },
		network: { failedRequests: [{ url: "https://example.com/api", status: 500 }] },
		nodes: [{ id: "n1", role: "button", name: "Submit", boundingBox: { x: 0, y: 0, width: 100, height: 40 } }],
		interactiveElements: [],
		bugs: [],
		...overrides,
	};
}

function makeCollector(state: TaloxPageState) {
	return {
		collect: vi.fn().mockResolvedValue(state),
		page: {
			screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
		},
	} as any;
}

function makeDetector(hasChallenge = false) {
	return {
		analyze: vi.fn().mockReturnValue({
			hasChallenge,
			challenges: [],
			primaryChallenge: null,
			timestamp: new Date().toISOString(),
			url: "https://example.com",
		}),
	} as any;
}

function makeRulesEngine(bugs: any[] = []) {
	return {
		analyze: vi.fn().mockReturnValue(bugs),
		diffStructural: vi.fn().mockReturnValue([]),
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PerceptionStack", () => {
	describe("PERCEPTION_PRESETS definitions", () => {
		it("cheap has only structural layer", () => {
			const p = PERCEPTION_PRESETS.cheap;
			expect(p.structural).toBe(true);
			expect(p.network).toBe(false);
			expect(p.bugs).toBe(false);
			expect(p.challenge).toBe(false);
			expect(p.screenshot).toBe(false);
		});

		it("medium adds network and challenge", () => {
			const p = PERCEPTION_PRESETS.medium;
			expect(p.structural).toBe(true);
			expect(p.network).toBe(true);
			expect(p.challenge).toBe(true);
			expect(p.bugs).toBe(false);
			expect(p.screenshot).toBe(false);
		});

		it("heavy enables all layers", () => {
			const p = PERCEPTION_PRESETS.heavy;
			for (const v of Object.values(p)) {
				expect(v).toBe(true);
			}
		});
	});

	describe("cheap preset", () => {
		it("strips console errors and network failures", async () => {
			const state = makeBaseState();
			const stack = new PerceptionStack(makeCollector(state));
			const result = await stack.collect("cheap");
			expect(result.console.errors).toHaveLength(0);
			expect(result.network.failedRequests).toHaveLength(0);
		});

		it("strips bugs", async () => {
			const state = makeBaseState({
				bugs: [{ type: "missing-label", message: "x", severity: "warning", nodeId: "n1" }],
			});
			const stack = new PerceptionStack(makeCollector(state));
			const result = await stack.collect("cheap");
			expect(result.bugs).toHaveLength(0);
		});

		it("does not call challenge detector", async () => {
			const detector = makeDetector();
			const stack = new PerceptionStack(makeCollector(makeBaseState()), detector);
			await stack.collect("cheap");
			expect(detector.analyze).not.toHaveBeenCalled();
		});

		it("does not include screenshotBase64", async () => {
			const stack = new PerceptionStack(makeCollector(makeBaseState()));
			const result = await stack.collect("cheap");
			expect(result.screenshotBase64).toBeUndefined();
		});

		it("annotates perceptionPreset and perceptionLayers", async () => {
			const stack = new PerceptionStack(makeCollector(makeBaseState()));
			const result = await stack.collect("cheap");
			expect(result.perceptionPreset).toBe("cheap");
			expect(result.perceptionLayers.structural).toBe(true);
			expect(result.perceptionLayers.network).toBe(false);
		});
	});

	describe("medium preset", () => {
		it("preserves console errors and failed requests", async () => {
			const state = makeBaseState();
			const stack = new PerceptionStack(makeCollector(state));
			const result = await stack.collect("medium");
			expect(result.console.errors).toHaveLength(1);
			expect(result.network.failedRequests).toHaveLength(1);
		});

		it("runs challenge detector when provided", async () => {
			const detector = makeDetector(true);
			const stack = new PerceptionStack(makeCollector(makeBaseState()), detector);
			const result = await stack.collect("medium");
			expect(detector.analyze).toHaveBeenCalledOnce();
			expect(result.challengeState?.hasChallenge).toBe(true);
		});

		it("does not capture screenshot", async () => {
			const collector = makeCollector(makeBaseState());
			const stack = new PerceptionStack(collector);
			const result = await stack.collect("medium");
			expect(result.screenshotBase64).toBeUndefined();
			expect(collector.page.screenshot).not.toHaveBeenCalled();
		});
	});

	describe("heavy preset", () => {
		it("captures screenshot as base64", async () => {
			const collector = makeCollector(makeBaseState());
			const stack = new PerceptionStack(collector);
			const result = await stack.collect("heavy");
			expect(typeof result.screenshotBase64).toBe("string");
			expect(result.screenshotBase64!.length).toBeGreaterThan(0);
		});

		it("runs rules engine when provided", async () => {
			const engine = makeRulesEngine([
				{ type: "layout-bug", message: "overlap detected", severity: "error", nodeId: "n1" },
			]);
			const stack = new PerceptionStack(makeCollector(makeBaseState()));
			const result = await stack.collect("heavy", { rulesEngine: engine });
			expect(engine.analyze).toHaveBeenCalled();
			expect(result.bugs.length).toBeGreaterThan(0);
		});

		it("runs diffStructural when previousState is provided", async () => {
			const diffBug = { type: "structural-change", message: "node removed", severity: "warning", nodeId: "n1" };
			const engine = makeRulesEngine([]);
			engine.diffStructural = vi.fn().mockReturnValue([diffBug]);

			const prev = makeBaseState({ url: "https://example.com/prev" });
			const current = makeBaseState();
			const stack = new PerceptionStack(makeCollector(current));
			const result = await stack.collect("heavy", { rulesEngine: engine, previousState: prev });
			expect(engine.diffStructural).toHaveBeenCalledWith(prev, current);
			expect(result.bugs).toContainEqual(diffBug);
		});

		it("skips bugs layer gracefully if no rules engine provided", async () => {
			const state = makeBaseState({ bugs: [{ type: "x", message: "y", severity: "error", nodeId: "n1" }] });
			const stack = new PerceptionStack(makeCollector(state));
			const result = await stack.collect("heavy");
			expect(result.bugs).toHaveLength(0); // heavy without rulesEngine should clear bugs
		});
	});

	describe("session-level caching", () => {
		it("returns cached result on second call with same url + preset", async () => {
			const collector = makeCollector(makeBaseState());
			const stack = new PerceptionStack(collector);

			const first = await stack.collect("medium");
			const second = await stack.collect("medium");

			expect(collector.collect).toHaveBeenCalledOnce();
			expect(first).toBe(second); // same reference
		});

		it("calls collector again after invalidate()", async () => {
			const collector = makeCollector(makeBaseState());
			const stack = new PerceptionStack(collector);

			await stack.collect("medium");
			stack.invalidate();
			await stack.collect("medium");

			expect(collector.collect).toHaveBeenCalledTimes(2);
		});

		it("does NOT share cache across different presets", async () => {
			const collector = makeCollector(makeBaseState());
			const stack = new PerceptionStack(collector);

			await stack.collect("cheap");
			await stack.collect("medium");

			expect(collector.collect).toHaveBeenCalledTimes(2);
		});

		it("isCached returns true after collection", async () => {
			const state = makeBaseState();
			const stack = new PerceptionStack(makeCollector(state));
			expect(stack.isCached(state.url, "cheap")).toBe(false);
			await stack.collect("cheap");
			expect(stack.isCached(state.url, "cheap")).toBe(true);
		});

		it("cacheSize reflects number of cached entries", async () => {
			const stack = new PerceptionStack(makeCollector(makeBaseState()));
			expect(stack.cacheSize).toBe(0);
			await stack.collect("cheap");
			await stack.collect("medium");
			expect(stack.cacheSize).toBe(2);
			stack.invalidate();
			expect(stack.cacheSize).toBe(0);
		});
	});

	describe("layer overrides", () => {
		it("can override cheap to include network", async () => {
			const state = makeBaseState();
			const stack = new PerceptionStack(makeCollector(state));
			const result = await stack.collect("cheap", { layers: { network: true } });
			expect(result.network.failedRequests).toHaveLength(1);
			expect(result.perceptionLayers.network).toBe(true);
		});

		it("can override heavy to skip screenshot", async () => {
			const collector = makeCollector(makeBaseState());
			const stack = new PerceptionStack(collector);
			const result = await stack.collect("heavy", { layers: { screenshot: false } });
			expect(result.screenshotBase64).toBeUndefined();
			expect(collector.page.screenshot).not.toHaveBeenCalled();
		});
	});

	describe("output contract", () => {
		it("always includes perceivedAt timestamp", async () => {
			const stack = new PerceptionStack(makeCollector(makeBaseState()));
			const result = await stack.collect("medium");
			expect(typeof result.perceivedAt).toBe("string");
			expect(new Date(result.perceivedAt).getFullYear()).toBeGreaterThan(2000);
		});

		it("always includes original TaloxPageState fields", async () => {
			const state = makeBaseState();
			const stack = new PerceptionStack(makeCollector(state));
			const result = await stack.collect("cheap");
			expect(result.url).toBe(state.url);
			expect(result.title).toBe(state.title);
			expect(result.nodes).toHaveLength(1);
		});
	});
});
