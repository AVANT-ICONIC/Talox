/**
 * Tests for OverlayInjector — browser overlay injection and bridge event routing.
 * Playwright Page is mocked; esbuild bundle loading is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventBus } from "../../src/core/controller/EventBus.js";
import type { AnnotationBuffer } from "../../src/core/observe/AnnotationBuffer.js";
import { OverlayInjector } from "../../src/core/observe/OverlayInjector.js";
import type { AnnotationEntry } from "../../src/types/annotation.js";
import type { TaloxInteraction } from "../../src/types/session.js";

// ─── Mock Factories ───────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AnnotationEntry> = {}): AnnotationEntry {
	return {
		id: crypto.randomUUID(),
		interactionIndex: 0,
		timestamp: new Date().toISOString(),
		labels: ["bug"],
		comment: "Test annotation",
		element: {
			tag: "button",
			role: "button",
			text: "Click",
			selector: "button",
			boundingBox: { x: 0, y: 0, width: 100, height: 40 },
		},
		...overrides,
	};
}

function createMockPage() {
	const listeners: Record<string, Function[]> = {};
	return {
		exposeFunction: vi.fn().mockResolvedValue(undefined),
		addInitScript: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockResolvedValue(undefined),
		on: vi.fn((event: string, handler: Function) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(handler);
		}),
		// Helper to simulate a 'load' event from the page
		_fireLoad() {
			for (const h of listeners["load"] ?? []) h();
		},
		_listeners: listeners,
	};
}

function createMockAnnotationBuffer(): AnnotationBuffer {
	return {
		push: vi.fn(),
		undo: vi.fn().mockReturnValue(undefined),
		size: 0,
		getAll: vi.fn().mockReturnValue([]),
		isEmpty: true,
	} as any;
}

function createMockEventBus(): EventBus<any> {
	return {
		emit: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		once: vi.fn(),
	} as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("OverlayInjector", () => {
	let buffer: AnnotationBuffer;
	let eventBus: EventBus<any>;
	let interactions: TaloxInteraction[];

	beforeEach(() => {
		buffer = createMockAnnotationBuffer();
		eventBus = createMockEventBus();
		interactions = [];
	});

	function createInjector(
		overrides: {
			onInteraction?: (i: TaloxInteraction) => Promise<void>;
			onSessionEndRequest?: () => Promise<void>;
		} = {},
	) {
		return new OverlayInjector(
			"test-session-id",
			new Date().toISOString(),
			buffer,
			eventBus,
			interactions,
			overrides.onInteraction,
			overrides.onSessionEndRequest,
		);
	}

	it("constructor stores parameters without error", () => {
		const injector = createInjector();
		expect(injector).toBeInstanceOf(OverlayInjector);
	});

	it("inject exposes __taloxEmit__ and adds init script on first call", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);

		expect(page.exposeFunction).toHaveBeenCalledTimes(1);
		expect(page.exposeFunction).toHaveBeenCalledWith("__taloxEmit__", expect.any(Function));
		expect(page.addInitScript).toHaveBeenCalledTimes(1);
	});

	it("inject is idempotent — second call on same page does nothing", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);
		await injector.inject(page); // second call

		// exposeFunction and addInitScript should still only be called once
		expect(page.exposeFunction).toHaveBeenCalledTimes(1);
		expect(page.addInitScript).toHaveBeenCalledTimes(1);
	});

	it("inject registers a load event listener on the page", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);

		expect(page.on).toHaveBeenCalledWith("load", expect.any(Function));
	});

	it("annotation:add bridge event pushes to buffer and emits on eventBus", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);

		// Grab the __taloxEmit__ handler that was registered
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;
		const entry = makeEntry();
		(buffer as any).size = 1;

		await emitHandler("annotation:add", entry);

		expect(buffer.push).toHaveBeenCalledWith(entry);
		expect(eventBus.emit).toHaveBeenCalledWith("annotationAdded", {
			entry,
			bufferSize: 1,
		});
	});

	it("annotation:undo bridge event calls buffer.undo and emits annotationUndone", async () => {
		const injector = createInjector();
		const page = createMockPage();
		const removed = makeEntry({ comment: "removed" });
		(buffer.undo as any).mockReturnValue(removed);
		(buffer as any).size = 0;

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		await emitHandler("annotation:undo", {});

		expect(buffer.undo).toHaveBeenCalled();
		expect(eventBus.emit).toHaveBeenCalledWith("annotationUndone", {
			removed,
			bufferSize: 0,
		});
	});

	it("annotation:undo with empty buffer does not emit annotationUndone", async () => {
		const injector = createInjector();
		const page = createMockPage();
		(buffer.undo as any).mockReturnValue(undefined);

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		await emitHandler("annotation:undo", {});

		expect(eventBus.emit).not.toHaveBeenCalledWith("annotationUndone", expect.anything());
	});

	it("interaction:click bridge event pushes to interactions array when no onInteraction", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		const clickPayload = {
			index: 1,
			timestamp: new Date().toISOString(),
			url: "https://example.com",
			type: "click" as const,
			element: { tag: "button", selector: "button", boundingBox: { x: 0, y: 0, width: 100, height: 40 } },
			consoleErrors: ["error"],
			networkFailures: [{ url: "https://bad.com", status: 500 }],
		};

		await emitHandler("interaction:click", clickPayload);

		expect(interactions).toHaveLength(1);
		// Bridge adds empty arrays for consoleErrors and networkFailures
		expect(interactions[0].consoleErrors).toEqual([]);
		expect(interactions[0].networkFailures).toEqual([]);
	});

	it("interaction:click calls onInteraction callback when provided", async () => {
		const onInteraction = vi.fn().mockResolvedValue(undefined);
		const injector = createInjector({ onInteraction });
		const page = createMockPage();

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		const clickPayload = {
			index: 2,
			timestamp: new Date().toISOString(),
			url: "https://example.com/page",
			type: "click" as const,
		};

		await emitHandler("interaction:click", clickPayload);

		expect(onInteraction).toHaveBeenCalledTimes(1);
		expect(onInteraction.mock.calls[0][0].index).toBe(2);
		// interactions array should NOT be used
		expect(interactions).toHaveLength(0);
	});

	it("session:end bridge event calls onSessionEndRequest", async () => {
		const onEnd = vi.fn().mockResolvedValue(undefined);
		const injector = createInjector({ onSessionEndRequest: onEnd });
		const page = createMockPage();

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		await emitHandler("session:end", {});

		// It's called with void (fire-and-forget), so give microtasks a chance
		await new Promise((r) => setTimeout(r, 10));
		expect(onEnd).toHaveBeenCalledTimes(1);
	});

	it("session:end does nothing when onSessionEndRequest is not provided", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		// Should not throw
		await expect(emitHandler("session:end", {})).resolves.toBeUndefined();
	});

	it("snapshot:request emits stateChanged on the eventBus", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		const payload = { url: "https://example.com", nodes: [] };
		await emitHandler("snapshot:request", payload);

		expect(eventBus.emit).toHaveBeenCalledWith("stateChanged", payload);
	});

	it("unknown event type does not throw", async () => {
		const injector = createInjector();
		const page = createMockPage();

		await injector.inject(page);
		const emitHandler = page.exposeFunction.mock.calls[0][1] as Function;

		// Should not throw — just warns to console
		await expect(emitHandler("unknown:event", {})).resolves.toBeUndefined();
	});

	it("inject works on multiple different pages independently", async () => {
		const injector = createInjector();
		const page1 = createMockPage();
		const page2 = createMockPage();

		await injector.inject(page1);
		await injector.inject(page2);

		expect(page1.exposeFunction).toHaveBeenCalledTimes(1);
		expect(page2.exposeFunction).toHaveBeenCalledTimes(1);
		expect(page1.addInitScript).toHaveBeenCalledTimes(1);
		expect(page2.addInitScript).toHaveBeenCalledTimes(1);
	});
});
