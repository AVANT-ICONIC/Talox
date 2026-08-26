import { afterEach, describe, expect, it, vi } from "vitest";
import { PerceptionStack } from "../../src/core/PerceptionStack.js";
import * as VisualReasoner from "../../src/core/VisualReasoner.js";

function makeReasoner(name: string) {
	return {
		name,
		analyze: vi.fn(async () => `${name}-fallback`),
	} satisfies VisualReasoner.VisualReasoner;
}

function makeCollector() {
	const closeHandlers: Array<() => void> = [];
	const page = {
		on: vi.fn((event: string, handler: () => void) => {
			if (event === "close") closeHandlers.push(handler);
		}),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("image")),
	};
	const collector = {
		getPage: () => page,
		collect: vi.fn(),
	} as any;
	return { collector, page, closeHandlers };
}

afterEach(() => {
	VisualReasoner.setVisualEmitter(null);
	VisualReasoner.setVisualReasoner(null);
});

describe("visual question cancellation ownership", () => {
	it("cancels an owner's pending question without invoking its fallback reasoner", async () => {
		const owner = {};
		const reasoner = makeReasoner("owned");
		VisualReasoner.setScopedVisualScope(owner, {
			emitter: vi.fn(),
			reasoner,
		});

		const answerPromise = VisualReasoner.askVisualScoped(owner, Buffer.from("image"), "pending", 10_000);

		expect(VisualReasoner.cancelScopedVisualQuestions(owner)).toBe(1);
		await expect(answerPromise).resolves.toBeNull();
		expect(reasoner.analyze).not.toHaveBeenCalled();
		expect(VisualReasoner.cancelScopedVisualQuestions(owner)).toBe(0);
	});

	it("cancels only the source tab while preserving same-session resolution for sibling tabs", async () => {
		const ownerA = {};
		const ownerB = {};
		const ids = new Map<string, string>();
		const reasoner = makeReasoner("shared");
		const sharedScope: VisualReasoner.VisualScope = {
			emitter: (payload) => ids.set(payload.question, payload.id),
			reasoner,
		};
		VisualReasoner.setScopedVisualScope(ownerA, sharedScope);
		VisualReasoner.setScopedVisualScope(ownerB, sharedScope);

		const answerA = VisualReasoner.askVisualScoped(ownerA, Buffer.from("a"), "question-a", 10_000);
		const answerB = VisualReasoner.askVisualScoped(ownerB, Buffer.from("b"), "question-b", 10_000);
		const idB = ids.get("question-b");
		expect(idB).toBeTruthy();

		expect(VisualReasoner.cancelScopedVisualQuestions(ownerA)).toBe(1);
		expect(VisualReasoner.resolveVisualScoped(ownerB, idB!, "answer-b")).toBe(true);

		await expect(answerA).resolves.toBeNull();
		await expect(answerB).resolves.toBe("answer-b");
		expect(reasoner.analyze).not.toHaveBeenCalled();
	});

	it("binds one page-close cancellation handler per perception collector", async () => {
		const { collector, page, closeHandlers } = makeCollector();
		const reasoner = makeReasoner("page");
		VisualReasoner.setScopedVisualScope(collector, {
			emitter: vi.fn(),
			reasoner,
		});

		const stackA = new PerceptionStack(collector);
		new PerceptionStack(collector);
		expect(page.on).toHaveBeenCalledTimes(1);
		expect(closeHandlers).toHaveLength(1);

		const answerPromise = stackA.askVisual("will-close");
		await Promise.resolve();
		closeHandlers[0]!();

		await expect(answerPromise).resolves.toBeNull();
		expect(reasoner.analyze).not.toHaveBeenCalled();
	});

	it("does not let scoped cancellation affect standalone pending questions", async () => {
		const owner = {};
		let questionId = "";
		VisualReasoner.setVisualEmitter((payload) => {
			questionId = payload.id;
		});

		const answerPromise = VisualReasoner.askVisual(Buffer.from("image"), "standalone", 10_000);
		expect(questionId).not.toBe("");
		expect(VisualReasoner.cancelScopedVisualQuestions(owner)).toBe(0);
		VisualReasoner.resolveVisual(questionId, "standalone-answer");

		await expect(answerPromise).resolves.toBe("standalone-answer");
	});
});
