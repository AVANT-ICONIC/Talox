import { afterEach, describe, expect, it, vi } from "vitest";
import { PerceptionStack } from "../../src/core/PerceptionStack.js";
import { EventBus } from "../../src/core/controller/EventBus.js";
import { SessionManager } from "../../src/core/controller/SessionManager.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";
import {
	askVisual,
	getScopedVisualEmitter,
	resolveVisual,
	setScopedVisualEmitter,
	setVisualEmitter,
	setVisualReasoner,
	type VisualQuestionPayload,
} from "../../src/core/VisualReasoner.js";
import type { TaloxEventMap } from "../../src/types/events.js";
import { DEFAULT_SETTINGS } from "../../src/types/settings.js";

function makeCollector() {
	const page = {
		screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
	};
	return {
		collect: vi.fn(),
		getPage: () => page,
	} as any;
}

function makePage() {
	return {
		on: vi.fn(),
	} as any;
}

afterEach(() => {
	setVisualEmitter(null);
	setVisualReasoner(null);
});

describe("visual question routing ownership", () => {
	it("routes concurrent perception questions only to their owning collectors", async () => {
		const collectorA = makeCollector();
		const collectorB = makeCollector();
		const emitterA = vi.fn((payload: VisualQuestionPayload) => resolveVisual(payload.id, "answer-a"));
		const emitterB = vi.fn((payload: VisualQuestionPayload) => resolveVisual(payload.id, "answer-b"));
		const globalEmitter = vi.fn((payload: VisualQuestionPayload) => resolveVisual(payload.id, "wrong-global-answer"));

		setVisualEmitter(globalEmitter);
		setScopedVisualEmitter(collectorA, emitterA);
		setScopedVisualEmitter(collectorB, emitterB);

		const [answerA, answerB] = await Promise.all([
			new PerceptionStack(collectorA).askVisual("question-a"),
			new PerceptionStack(collectorB).askVisual("question-b"),
		]);

		expect(answerA).toBe("answer-a");
		expect(answerB).toBe("answer-b");
		expect(emitterA).toHaveBeenCalledOnce();
		expect(emitterB).toHaveBeenCalledOnce();
		expect(emitterA.mock.calls[0]?.[0].question).toBe("question-a");
		expect(emitterB.mock.calls[0]?.[0].question).toBe("question-b");
		expect(globalEmitter).not.toHaveBeenCalled();
	});

	it("keeps the global emitter as the standalone fallback", async () => {
		const globalEmitter = vi.fn((payload: VisualQuestionPayload) => resolveVisual(payload.id, "standalone-answer"));
		setVisualEmitter(globalEmitter);

		const answer = await askVisual(Buffer.from("fake-png"), "standalone-question", 100);

		expect(answer).toBe("standalone-answer");
		expect(globalEmitter).toHaveBeenCalledOnce();
		expect(globalEmitter.mock.calls[0]?.[0].question).toBe("standalone-question");
	});

	it("binds each SessionManager collector to that manager's EventBus", () => {
		const eventsA = new EventBus<TaloxEventMap>();
		const eventsB = new EventBus<TaloxEventMap>();
		const managerA = new SessionManager({ ...DEFAULT_SETTINGS }, eventsA, ".");
		const managerB = new SessionManager({ ...DEFAULT_SETTINGS }, eventsB, ".");
		const seenA = vi.fn();
		const seenB = vi.fn();
		eventsA.on("visualQuestion", seenA);
		eventsB.on("visualQuestion", seenB);

		const collectorA = (managerA as any).createStateCollector(makePage());
		const collectorB = (managerB as any).createStateCollector(makePage());
		const payloadA: VisualQuestionPayload = {
			id: "a",
			question: "owned-by-a",
			image: { format: "base64", data: "a" },
		};
		const payloadB: VisualQuestionPayload = {
			id: "b",
			question: "owned-by-b",
			image: { format: "base64", data: "b" },
		};

		getScopedVisualEmitter(collectorA)?.(payloadA);
		getScopedVisualEmitter(collectorB)?.(payloadB);

		expect(seenA).toHaveBeenCalledOnce();
		expect(seenA).toHaveBeenCalledWith(payloadA);
		expect(seenB).toHaveBeenCalledOnce();
		expect(seenB).toHaveBeenCalledWith(payloadB);
	});

	it("constructing controllers does not overwrite the standalone emitter", async () => {
		const standaloneEmitter = vi.fn((payload: VisualQuestionPayload) => resolveVisual(payload.id, "still-standalone"));
		setVisualEmitter(standaloneEmitter);

		new TaloxController();
		new TaloxController();
		const answer = await askVisual(Buffer.from("fake-png"), "after-controller-construction", 100);

		expect(answer).toBe("still-standalone");
		expect(standaloneEmitter).toHaveBeenCalledOnce();
	});
});
