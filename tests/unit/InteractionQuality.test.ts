/**
 * @file InteractionQuality.test.ts
 * @description Tests for interaction quality scoring engine.
 */

import { describe, expect, it } from "vitest";
import {
	scoreMouse,
	scoreTyping,
	scoreScroll,
	scoreClick,
	computeQuality,
	scoreInteraction,
	QualityTracker,
	type MouseMetrics,
	type TypingMetrics,
	type ScrollMetrics,
	type ClickMetrics,
} from "../../src/core/InteractionQuality.js";

// ─── scoreMouse ───────────────────────────────────────────────────────────────

describe("scoreMouse", () => {
	it("returns 50 for too few points", () => {
		expect(
			scoreMouse({ points: [{ x: 0, y: 0, timestampMs: 0 }], movementStyle: "smooth", accelerationCurve: "ease-out" }),
		).toBe(50);
	});

	it("scores smooth + ease-out highly", () => {
		const points = [
			{ x: 0, y: 0, timestampMs: 0 },
			{ x: 50, y: 30, timestampMs: 100 },
			{ x: 100, y: 50, timestampMs: 250 },
			{ x: 200, y: 80, timestampMs: 350 },
		];
		const score = scoreMouse({ points, movementStyle: "smooth", accelerationCurve: "ease-out" });
		expect(score).toBeGreaterThan(60);
	});

	it("penalizes linear + jerky", () => {
		const points = [
			{ x: 0, y: 0, timestampMs: 0 },
			{ x: 100, y: 0, timestampMs: 100 },
			{ x: 200, y: 0, timestampMs: 200 },
		];
		const score = scoreMouse({ points, movementStyle: "jerky", accelerationCurve: "linear" });
		expect(score).toBeLessThan(50);
	});

	it("clamps to 0–100", () => {
		const points = Array.from({ length: 10 }, (_, i) => ({
			x: i * 10,
			y: i * 5,
			timestampMs: i * 100,
		}));
		const s = scoreMouse({ points, movementStyle: "smooth", accelerationCurve: "bezier" });
		expect(s).toBeGreaterThanOrEqual(0);
		expect(s).toBeLessThanOrEqual(100);
	});
});

// ─── scoreTyping ──────────────────────────────────────────────────────────────

describe("scoreTyping", () => {
	it("returns 50 for too few key intervals", () => {
		expect(scoreTyping({ keyIntervalsMs: [100], textLength: 5, rhythm: "medium", typoCount: 0 })).toBe(50);
	});

	it("scores variable rhythm with typos highly", () => {
		const intervals = [80, 200, 60, 300, 90, 150, 250, 70, 180, 400];
		const score = scoreTyping({
			keyIntervalsMs: intervals,
			textLength: 50,
			rhythm: "variable",
			typoCount: 2,
		});
		expect(score).toBeGreaterThan(60);
	});

	it("penalizes fast + consistent", () => {
		const intervals = [50, 50, 50, 50, 50, 50, 50, 50];
		const score = scoreTyping({
			keyIntervalsMs: intervals,
			textLength: 20,
			rhythm: "fast",
			typoCount: 0,
		});
		expect(score).toBeLessThan(50);
	});
});

// ─── scoreScroll ──────────────────────────────────────────────────────────────

describe("scoreScroll", () => {
	it("returns 50 for too few scroll events", () => {
		expect(scoreScroll({ scrollEvents: [{ deltaY: 100, timestampMs: 0 }], totalDistance: 100 })).toBe(50);
	});

	it("scores variable + paused scrolling highly", () => {
		const events = [
			{ deltaY: 300, timestampMs: 0 },
			{ deltaY: 200, timestampMs: 200 },
			{ deltaY: 800, timestampMs: 900 },
			{ deltaY: 150, timestampMs: 1100 },
		];
		const score = scoreScroll({ scrollEvents: events, totalDistance: 1450 });
		expect(score).toBeGreaterThan(55);
	});

	it("scores zero distance as 50", () => {
		expect(scoreScroll({ scrollEvents: [], totalDistance: 0 })).toBe(50);
	});
});

// ─── scoreClick ───────────────────────────────────────────────────────────────

describe("scoreClick", () => {
	it("scores natural click timing highly", () => {
		expect(scoreClick({ preClickHoverMs: 200, postClickPauseMs: 300, doubleClickGapMs: 0 })).toBeGreaterThan(60);
	});

	it("penalizes instant click", () => {
		expect(scoreClick({ preClickHoverMs: 0, postClickPauseMs: 0, doubleClickGapMs: 0 })).toBeLessThan(50);
	});

	it("rewards natural double-click gap", () => {
		expect(scoreClick({ preClickHoverMs: 150, postClickPauseMs: 200, doubleClickGapMs: 300 })).toBeGreaterThan(65);
	});
});

// ─── computeQuality ───────────────────────────────────────────────────────────

describe("computeQuality", () => {
	it("defaults missing dimensions to 50", () => {
		const q = computeQuality({ mouse: 80 });
		expect(q.dimensions.mouse).toBe(80);
		expect(q.dimensions.typing).toBe(50);
		expect(q.overall).toBeGreaterThan(50);
	});

	it("averages all dimensions equally", () => {
		const q = computeQuality({ mouse: 80, typing: 60, scroll: 40, click: 20 });
		expect(q.overall).toBe(50);
	});
});

// ─── scoreInteraction ─────────────────────────────────────────────────────────

describe("scoreInteraction", () => {
	it("scores mouse + typing + scroll + click", () => {
		const mouse: MouseMetrics = {
			points: [
				{ x: 0, y: 0, timestampMs: 0 },
				{ x: 50, y: 30, timestampMs: 100 },
				{ x: 100, y: 50, timestampMs: 250 },
			],
			movementStyle: "smooth",
			accelerationCurve: "ease-out",
		};
		const typing: TypingMetrics = {
			keyIntervalsMs: [80, 200, 60, 300],
			textLength: 20,
			rhythm: "variable",
			typoCount: 1,
		};
		const q = scoreInteraction(mouse, typing);
		expect(q.overall).toBeGreaterThan(50);
		expect(q.dimensions.mouse).toBeDefined();
		expect(q.dimensions.typing).toBeDefined();
	});

	it("returns neutral for no metrics", () => {
		const q = scoreInteraction();
		expect(q.overall).toBe(50);
	});
});

// ─── QualityTracker ───────────────────────────────────────────────────────────

describe("QualityTracker", () => {
	it("starts at neutral 50", () => {
		const t = new QualityTracker();
		expect(t.overall).toBe(50);
	});

	it("tracks rolling average", () => {
		const t = new QualityTracker();
		t.push(computeQuality({ mouse: 80, typing: 80, scroll: 80, click: 80 }));
		t.push(computeQuality({ mouse: 60, typing: 60, scroll: 60, click: 60 }));
		expect(t.overall).toBe(70);
	});

	it("evicts old samples", () => {
		const t = new QualityTracker(2);
		t.push(computeQuality({ mouse: 0, typing: 0, scroll: 0, click: 0 }));
		t.push(computeQuality({ mouse: 0, typing: 0, scroll: 0, click: 0 }));
		t.push(computeQuality({ mouse: 100, typing: 100, scroll: 100, click: 100 }));
		expect(t.overall).toBe(50); // (0 + 100) / 2
	});

	it("detects improving trend", () => {
		const t = new QualityTracker();
		for (let i = 0; i < 6; i++) {
			t.push(computeQuality({ mouse: 40 + i * 10, typing: 50, scroll: 50, click: 50 }));
		}
		expect(t.trend).toBe("improving");
	});

	it("detects declining trend", () => {
		const t = new QualityTracker();
		for (let i = 0; i < 6; i++) {
			t.push(computeQuality({ mouse: 90 - i * 10, typing: 50, scroll: 50, click: 50 }));
		}
		expect(t.trend).toBe("declining");
	});

	it("reports stable for too few samples", () => {
		const t = new QualityTracker();
		t.push(computeQuality({ mouse: 80 }));
		expect(t.trend).toBe("stable");
	});
});
