import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/controller/EventBus";
import { AdaptationEngine } from "../../src/core/smart/AdaptationEngine";
import { DEFAULT_SETTINGS } from "../../src/types/settings";

function makePageState(overrides: Partial<any> = {}): any {
	return {
		url: "https://example.com",
		title: "Example",
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
	};
}

function makeEngine(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
	const bus = new EventBus();
	const settings = { ...DEFAULT_SETTINGS, ...overrides };
	const eng = new AdaptationEngine(settings, bus as any);
	return { bus, settings, eng };
}

describe("AdaptationEngine", () => {
	it("returns false for a clean page (no detection)", async () => {
		const { eng } = makeEngine();
		const result = await eng.evaluate(makePageState());
		expect(result).toBe(false);
	});

	it("returns true and emits adapted event on CAPTCHA detection", async () => {
		const { bus, eng } = makeEngine();
		const handler = vi.fn();
		bus.on("adapted" as any, handler);

		const result = await eng.evaluate(makePageState({ title: "Just a moment..." }));
		expect(result).toBe(true);
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0].reason).toBe("captcha_detected");
	});

	it("patches settings directly when strategy has settingsPatch", async () => {
		const { settings, eng } = makeEngine();
		expect(settings.automaticThinkingEnabled).toBe(true);
		await eng.evaluate(makePageState({ title: "Just a moment..." }));
		expect(settings.automaticThinkingEnabled).toBe(false);
	});

	it("records adaptation in getLastAdaptation()", async () => {
		const { eng } = makeEngine();
		expect(eng.getLastAdaptation()).toBeNull();
		await eng.evaluate(makePageState({ title: "Just a moment..." }));
		const last = eng.getLastAdaptation();
		expect(last).not.toBeNull();
		expect(last.reason).toBe("captcha_detected");
		expect(last.strategy).toBe("captcha_pause");
	});

	it("records outcome in domainMemory on adaptation", async () => {
		const { eng } = makeEngine();
		await eng.evaluate(makePageState({ title: "Just a moment..." }));
		const score = eng.domainMemory.getScore("https://example.com", "captcha_pause");
		expect(score).not.toBeNull();
		expect(score!.attempts).toBe(1);
	});

	it("recordStrategySuccess updates domain memory with success", async () => {
		const { eng } = makeEngine();
		await eng.evaluate(makePageState({ title: "Just a moment..." }));
		eng.recordStrategySuccess("https://example.com");
		const score = eng.domainMemory.getScore("https://example.com", "captcha_pause")!;
		expect(score.attempts).toBe(2);
		expect(score.successes).toBe(1);
	});

	it("recordStrategySuccess is a no-op with no prior adaptation", () => {
		const { eng } = makeEngine();
		eng.recordStrategySuccess("https://example.com");
		expect(eng.domainMemory.getScore("https://example.com", "anything")).toBeNull();
	});

	it("does NOT bypass escalation for bot_detection_hard even with bypassEscalation=true", async () => {
		const bus = new EventBus();
		const settings = { ...DEFAULT_SETTINGS };
		const handler = vi.fn();
		bus.on("adapted" as any, handler);
		const eng = new AdaptationEngine(settings, bus as any, undefined, true);
		// bot_detection_hard from BotDetector is not in the bypass list
		await eng.evaluate(makePageState({ url: "https://example.com/blocked" }));
		expect(handler).toHaveBeenCalledOnce();
	});

	it("does NOT bypass escalation for rate_limit even with bypassEscalation=true", async () => {
		const bus = new EventBus();
		const settings = { ...DEFAULT_SETTINGS };
		const handler = vi.fn();
		bus.on("adapted" as any, handler);
		const eng = new AdaptationEngine(settings, bus as any, undefined, true);
		await eng.evaluate(
			makePageState({
				network: { failedRequests: [{ url: "/api", status: 429 }] },
			}),
		);
		expect(handler).toHaveBeenCalledOnce();
	});

	it("applies stealth_escalation strategy for bot_detection_hard with UA rotation", async () => {
		const { bus, settings, eng } = makeEngine();
		const handler = vi.fn();
		bus.on("adapted" as any, handler);
		await eng.evaluate(makePageState({ url: "https://example.com/blocked" }));
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0][0].reason).toBe("bot_detection_hard");
		expect(handler.mock.calls[0][0].strategy).toBe("stealth_escalation");
		// stealth_escalation patches these settings
		expect(settings.mouseSpeed).toBe(0.3);
		expect(settings.humanStealth).toBe(1);
		expect(settings.stealthLevel).toBe("high");
	});

	it("isSemanticHealingActive starts false", () => {
		const { eng } = makeEngine();
		expect(eng.isSemanticHealingActive()).toBe(false);
	});

	it("resetSemanticHealing clears the flag", () => {
		const { eng } = makeEngine();
		eng.resetSemanticHealing();
		expect(eng.isSemanticHealingActive()).toBe(false);
	});

	it("wasEscalated returns false and resets", () => {
		const { eng } = makeEngine();
		expect(eng.wasEscalated()).toBe(false);
		expect(eng.wasEscalated()).toBe(false);
	});

	it("getNextUserAgent returns rotating Mozilla UA strings", () => {
		const { eng } = makeEngine();
		const ua1 = eng.getNextUserAgent();
		const ua2 = eng.getNextUserAgent();
		expect(ua1).toContain("Mozilla");
		expect(ua2).toContain("Mozilla");
		expect(ua1).not.toBe(ua2);
	});

	it("getNextUserAgent wraps around after exhausting the list", () => {
		const { eng } = makeEngine();
		const uas = new Set<string>();
		for (let i = 0; i < 10; i++) {
			uas.add(eng.getNextUserAgent());
		}
		// 5 unique UAs in the rotation
		expect(uas.size).toBeLessThanOrEqual(5);
	});

	it("emits adapted with correct from/to snapshots", async () => {
		const { bus, eng } = makeEngine();
		const handler = vi.fn();
		bus.on("adapted" as any, handler);
		await eng.evaluate(makePageState({ title: "Just a moment..." }));
		const payload = handler.mock.calls[0][0];
		expect(payload.from.automaticThinkingEnabled).toBe(true);
		expect(payload.to.automaticThinkingEnabled).toBe(false);
	});

	it("patches rate_limit settings correctly", async () => {
		const { settings, eng } = makeEngine();
		await eng.evaluate(
			makePageState({
				network: { failedRequests: [{ url: "/api", status: 429 }] },
			}),
		);
		expect(settings.mouseSpeed).toBe(0.4);
		expect(settings.idleTimeout).toBe(15000);
	});
});
