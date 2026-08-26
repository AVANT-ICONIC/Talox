import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/controller/EventBus.js";
import { ObserveSession } from "../../src/core/observe/ObserveSession.js";
import type { TaloxEventMap } from "../../src/types/events.js";

function makeEmitterTarget() {
	const listeners = new Map<string, Set<(...args: any[]) => void>>();
	const target = {
		on: vi.fn((event: string, handler: (...args: any[]) => void) => {
			const handlers = listeners.get(event) ?? new Set<(...args: any[]) => void>();
			handlers.add(handler);
			listeners.set(event, handlers);
			return target;
		}),
		off: vi.fn((event: string, handler: (...args: any[]) => void) => {
			listeners.get(event)?.delete(handler);
			return target;
		}),
		_emit(event: string, ...args: any[]) {
			for (const handler of [...(listeners.get(event) ?? [])]) handler(...args);
		},
	};
	return target;
}

function makePage() {
	const emitter = makeEmitterTarget();
	const mainFrame = { url: () => "https://example.com/next" };
	return {
		...emitter,
		url: vi.fn(() => "https://example.com"),
		mainFrame: vi.fn(() => mainFrame),
		screenshot: vi.fn(async () => Buffer.from("frame")),
	};
}

function makeContext() {
	const emitter = makeEmitterTarget();
	return {
		...emitter,
		close: vi.fn(async () => undefined),
	};
}

const observedEvents: Array<keyof TaloxEventMap> = [
	"navigation",
	"consoleError",
	"networkError",
	"annotationAdded",
	"annotationUndone",
	"stateChanged",
	"bugDetected",
	"adapted",
];

describe("ObserveSession listener lifecycle", () => {
	it("removes only session-owned listeners after successful finalization", async () => {
		const eventBus = new EventBus<TaloxEventMap>();
		const externalNavigationListener = vi.fn();
		eventBus.on("navigation", externalNavigationListener);

		const page = makePage();
		const context = makeContext();
		const session = new ObserveSession(
			page as any,
			context as any,
			eventBus,
			{ toActionFrames: vi.fn(() => []) } as any,
			{ overlay: false, record: false },
		);

		await session.start();

		expect(eventBus.listenerCount("navigation")).toBe(2);
		for (const event of observedEvents.filter((event) => event !== "navigation")) {
			expect(eventBus.listenerCount(event)).toBe(1);
		}

		await session.endSession();

		expect(eventBus.listenerCount("navigation")).toBe(1);
		for (const event of observedEvents.filter((event) => event !== "navigation")) {
			expect(eventBus.listenerCount(event)).toBe(0);
		}
		expect(page.off).toHaveBeenCalledTimes(3);
		expect(context.off).toHaveBeenCalledTimes(1);

		eventBus.emit("navigation", { url: "https://external.example", title: "external" });
		expect(externalNavigationListener).toHaveBeenCalledTimes(1);
	});

	it("stops page events from mutating a finalized session", async () => {
		const eventBus = new EventBus<TaloxEventMap>();
		const page = makePage();
		const context = makeContext();
		const session = new ObserveSession(
			page as any,
			context as any,
			eventBus,
			{ toActionFrames: vi.fn(() => []) } as any,
			{ overlay: false, record: false },
		);

		await session.start();
		await session.endSession();

		page._emit("framenavigated", page.mainFrame());
		page._emit("console", { type: () => "error", text: () => "late error" });
		page._emit("requestfailed", {
			url: () => "https://example.com/late.js",
			failure: () => ({ errorText: "late failure" }),
			resourceType: () => "script",
		});

		expect(session.buildReport().interactions).toEqual([]);
		expect(eventBus.listenerCount("consoleError")).toBe(0);
		expect(eventBus.listenerCount("networkError")).toBe(0);
	});
});
