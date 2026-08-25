import { beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionReliability } from "../../src/core/InteractionReliability";
import type { TaloxNode } from "../../src/types/index";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<TaloxNode> & Pick<TaloxNode, "id">): TaloxNode {
	return {
		role: "button",
		name: overrides.id,
		boundingBox: { x: 0, y: 0, width: 100, height: 40 },
		...overrides,
	};
}

function makePage(
	overrides: Partial<{
		$: (sel: string) => Promise<any>;
		keyboard: { press: (key: string) => Promise<void> };
		evaluate: (...args: any[]) => Promise<any>;
		context: () => any;
	}> = {},
) {
	return {
		$: vi.fn().mockResolvedValue(null),
		keyboard: { press: vi.fn().mockResolvedValue(undefined) },
		evaluate: vi.fn().mockResolvedValue(undefined),
		context: vi.fn().mockReturnValue(null),
		...overrides,
	};
}

function makeElement(visible = true) {
	return {
		scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
		isVisible: vi.fn().mockResolvedValue(visible),
		click: vi.fn().mockResolvedValue(undefined),
		boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 10, width: 100, height: 40 }),
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const reliability = new InteractionReliability();

describe("InteractionReliability", () => {
	describe("classifyError", () => {
		it("classifies detached element errors", () => {
			expect(reliability.classifyError("Element is detached from the document")).toBe("detached");
			expect(reliability.classifyError("node is not attached to DOM")).toBe("detached");
		});

		it("classifies intercepted errors", () => {
			expect(reliability.classifyError("Element is intercepted by another element")).toBe("intercepted");
			expect(reliability.classifyError("element is not visible")).toBe("intercepted");
		});

		it("classifies viewport errors", () => {
			expect(reliability.classifyError("Element is outside of the viewport")).toBe("viewport");
		});

		it("classifies wrong-tab errors", () => {
			expect(reliability.classifyError("Target page closed")).toBe("wrong-tab");
			expect(reliability.classifyError("execution context was destroyed")).toBe("wrong-tab");
		});

		it("returns unknown for unrecognized messages", () => {
			expect(reliability.classifyError("some weird totally unknown error")).toBe("unknown");
		});
	});

	describe("resolveDuplicateSelector", () => {
		const nodes: TaloxNode[] = [
			makeNode({ id: "n1", name: "Submit", role: "button", boundingBox: { x: 0, y: 100, width: 80, height: 36 } }),
			makeNode({ id: "n2", name: "Submit", role: "button", boundingBox: { x: 0, y: 500, width: 120, height: 40 } }),
			makeNode({ id: "n3", name: "Cancel", role: "button", boundingBox: { x: 0, y: 300, width: 80, height: 36 } }),
		];

		it("detects duplicate when multiple nodes share the same name", () => {
			const result = reliability.resolveDuplicateSelector("Submit", nodes);
			expect(result.isDuplicate).toBe(true);
			expect(result.count).toBe(2);
		});

		it("returns the higher-scoring node (larger area, higher on page)", () => {
			const result = reliability.resolveDuplicateSelector("Submit", nodes);
			// n2 has larger area (120*40=4800) but n1 is higher on page (y=100 < 600, bonus 1.2)
			// n1: 80*36*1.2 = 3456; n2: 120*40*1.2 = 5760 (both above 600)
			expect(result.bestNode?.id).toBe("n2");
		});

		it("returns isDuplicate=false for unique selectors", () => {
			const result = reliability.resolveDuplicateSelector("Cancel", nodes);
			expect(result.isDuplicate).toBe(false);
			expect(result.bestNode?.id).toBe("n3");
		});

		it("returns isDuplicate=false when no nodes match", () => {
			const result = reliability.resolveDuplicateSelector("NonExistent", nodes);
			expect(result.isDuplicate).toBe(false);
			expect(result.bestNode).toBeNull();
		});
	});

	describe("resolveBeforeClick", () => {
		it("scrolls element into view on pre-flight", async () => {
			const el = makeElement();
			const page = makePage({ $: vi.fn().mockResolvedValue(el) });

			const result = await reliability.resolveBeforeClick(page, "#submit", []);
			expect(result.resolved).toBe(true);
			expect(el.scrollIntoViewIfNeeded).toHaveBeenCalled();
		});

		it("includes viewport attempt in the output", async () => {
			const el = makeElement();
			const page = makePage({ $: vi.fn().mockResolvedValue(el) });

			const result = await reliability.resolveBeforeClick(page, "#submit", []);
			const viewportAttempt = result.attempts.find((a) => a.mode === "viewport");
			expect(viewportAttempt).toBeDefined();
			expect(viewportAttempt?.success).toBe(true);
		});

		it("resolves duplicate label and updates resolvedSelector", async () => {
			const nodes: TaloxNode[] = [
				makeNode({ id: "n1", name: "Submit", role: "button", boundingBox: { x: 0, y: 100, width: 80, height: 36 } }),
				makeNode({ id: "n2", name: "Submit", role: "button", boundingBox: { x: 0, y: 500, width: 200, height: 50 } }),
			];
			const el = makeElement();
			const page = makePage({ $: vi.fn().mockResolvedValue(el) });

			const result = await reliability.resolveBeforeClick(page, "Submit", nodes);
			expect(result.resolved).toBe(true);
			const dupAttempt = result.attempts.find((a) => a.mode === "duplicate");
			expect(dupAttempt).toBeDefined();
			// resolvedSelector should now point to the best node's id
			expect(result.resolvedSelector).not.toBe("Submit");
		});

		it("returns resolved=true even if scroll throws (non-fatal)", async () => {
			const page = makePage({ $: vi.fn().mockRejectedValue(new Error("not found")) });
			const result = await reliability.resolveBeforeClick(page, "#missing", []);
			expect(result.resolved).toBe(true);
		});

		it("fails immediately when Playwright reports malformed CSS syntax", async () => {
			const syntaxError = new Error('Unexpected token "" while parsing css selector "[[[invalid"');
			const page = makePage({ $: vi.fn().mockRejectedValue(syntaxError) });

			await expect(reliability.resolveBeforeClick(page, "[[[invalid", [])).rejects.toBe(syntaxError);
		});
	});

	describe("recoverAfterFailure — viewport", () => {
		it("scrolls element into view and returns resolved=true", async () => {
			const el = makeElement(true);
			const page = makePage({ $: vi.fn().mockResolvedValue(el) });

			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("Element is outside of the viewport"),
				"#btn",
				[],
			);

			expect(result.resolved).toBe(true);
			expect(result.mode).toBe("viewport");
			expect(el.scrollIntoViewIfNeeded).toHaveBeenCalled();
			expect(result.resolvedElement).toBe(el);
		});

		it("returns resolved=false if element not found during viewport recovery", async () => {
			const page = makePage({ $: vi.fn().mockResolvedValue(null) });

			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("Element is outside of the viewport"),
				"#btn",
				[],
			);

			expect(result.resolved).toBe(false);
		});
	});

	describe("recoverAfterFailure — intercepted", () => {
		it("tries Escape key first and resolves if element becomes visible", async () => {
			const el = makeElement(true);
			const page = makePage({
				$: vi.fn().mockResolvedValue(el),
				keyboard: { press: vi.fn().mockResolvedValue(undefined) },
			});

			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("Element is intercepted by another element"),
				"#btn",
				[],
			);

			expect(page.keyboard.press).toHaveBeenCalledWith("Escape");
			expect(result.resolved).toBe(true);
			expect(result.mode).toBe("intercepted");
		});

		it("tries dispatch-click as last resort", async () => {
			const el = makeElement(false); // not visible after Escape
			const visibleEl = makeElement(true);
			let callCount = 0;
			const page = {
				$: vi.fn().mockImplementation(async (sel: string) => {
					// First calls for overlay dismissers return null; last call for target returns visible
					callCount++;
					if (callCount > 15) return visibleEl;
					if (sel === "#btn") return el;
					return null;
				}),
				keyboard: { press: vi.fn().mockResolvedValue(undefined) },
				evaluate: vi.fn().mockResolvedValue(undefined),
			};

			const result = await reliability.recoverAfterFailure(
				page as any,
				null,
				new Error("Element is intercepted by another element"),
				"#btn",
				[],
			);

			// dispatch-click attempt should have been tried
			expect(result.attempts.some((a) => a.strategy === "dispatch-click")).toBe(true);
		});
	});

	describe("recoverAfterFailure — detached", () => {
		it("re-finds element by semantic label from nodes snapshot", async () => {
			const nodes: TaloxNode[] = [
				makeNode({
					id: "n1",
					name: "Login button",
					role: "button",
					boundingBox: { x: 0, y: 100, width: 120, height: 44 },
				}),
			];
			const el = makeElement(true);
			const page = makePage({
				$: vi.fn().mockResolvedValue(el),
			});

			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("Element is detached from the document"),
				"#login-button",
				nodes,
			);

			expect(result.resolved).toBe(true);
			expect(result.mode).toBe("detached");
			expect(result.attempts[0]?.strategy).toBe("semantic-re-find");
		});

		it("returns resolved=false when no matching node found", async () => {
			const nodes: TaloxNode[] = [
				makeNode({
					id: "n1",
					name: "Totally unrelated",
					role: "heading",
					boundingBox: { x: 0, y: 0, width: 200, height: 30 },
				}),
			];
			const page = makePage();

			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("Element is detached from the document"),
				"#xyzzy-unique-id-that-wont-match",
				nodes,
			);

			expect(result.resolved).toBe(false);
		});
	});

	describe("recoverAfterFailure — wrong-tab", () => {
		it("scans all pages and brings correct tab to front", async () => {
			const el = makeElement(true);
			const wrongPage = makePage({ $: vi.fn().mockResolvedValue(null) });
			const correctPage = {
				$: vi.fn().mockResolvedValue(el),
				bringToFront: vi.fn().mockResolvedValue(undefined),
				url: () => "https://example.com/dashboard",
			};
			const context = { pages: () => [wrongPage, correctPage] };
			const page = makePage({ context: vi.fn().mockReturnValue(context) });

			const result = await reliability.recoverAfterFailure(
				page,
				context,
				new Error("Target page closed"),
				"#target",
				[],
			);

			expect(result.resolved).toBe(true);
			expect(result.mode).toBe("wrong-tab");
			expect(correctPage.bringToFront).toHaveBeenCalled();
			expect(result.resolvedElement).toBe(el);
		});

		it("returns resolved=false when no page has the element", async () => {
			const p1 = makePage({ $: vi.fn().mockResolvedValue(null) });
			const p2 = makePage({ $: vi.fn().mockResolvedValue(null) });
			const context = { pages: () => [p1, p2] };
			const page = makePage();

			const result = await reliability.recoverAfterFailure(
				page,
				context,
				new Error("Target page closed"),
				"#missing",
				[],
			);

			expect(result.resolved).toBe(false);
		});

		it("returns resolved=false when no context is available", async () => {
			const page = makePage({ context: vi.fn().mockReturnValue(null) });

			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("execution context was destroyed"),
				"#btn",
				[],
			);

			expect(result.resolved).toBe(false);
		});
	});

	describe("recoverAfterFailure — unknown", () => {
		it("returns resolved=false for unclassified errors", async () => {
			const page = makePage();
			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("some totally unknown failure"),
				"#btn",
				[],
			);
			expect(result.resolved).toBe(false);
			expect(result.mode).toBe("unknown");
		});
	});

	describe("attempt structure", () => {
		it("every attempt has required fields", async () => {
			const el = makeElement(true);
			const page = makePage({ $: vi.fn().mockResolvedValue(el) });
			const result = await reliability.recoverAfterFailure(
				page,
				null,
				new Error("Element is outside of the viewport"),
				"#btn",
				[],
			);
			for (const attempt of result.attempts) {
				expect(typeof attempt.mode).toBe("string");
				expect(typeof attempt.strategy).toBe("string");
				expect(typeof attempt.success).toBe("boolean");
				expect(typeof attempt.durationMs).toBe("number");
				expect(attempt.durationMs).toBeGreaterThanOrEqual(0);
			}
		});
	});
});
