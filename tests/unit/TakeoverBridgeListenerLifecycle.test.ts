import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/controller/EventBus.js";
import { TakeoverBridge } from "../../src/core/controller/TakeoverBridge.js";
import type { TaloxEventMap } from "../../src/types/events.js";

function makePage() {
	const listeners = new Map<string, Set<(...args: any[]) => void>>();
	const page = {
		addInitScript: vi.fn().mockResolvedValue(undefined),
		exposeFunction: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockResolvedValue(undefined),
		url: vi.fn().mockReturnValue("https://example.com"),
		on: vi.fn((event: string, handler: (...args: any[]) => void) => {
			const eventListeners = listeners.get(event) ?? new Set<(...args: any[]) => void>();
			eventListeners.add(handler);
			listeners.set(event, eventListeners);
			return page;
		}),
		off: vi.fn((event: string, handler: (...args: any[]) => void) => {
			listeners.get(event)?.delete(handler);
			return page;
		}),
		emit: (event: string, ...args: any[]) => {
			for (const handler of [...(listeners.get(event) ?? [])]) handler(...args);
		},
		listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
	};
	return page;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("TakeoverBridge listener lifecycle", () => {
	it("does not duplicate EventBus subscriptions across page reinitialization", async () => {
		const bus = new EventBus<TaloxEventMap>();
		const bridge = new TakeoverBridge(bus, 0);
		const firstPage = makePage();
		const secondPage = makePage();

		await bridge.initialize(firstPage as any, true);
		expect(bus.listenerCount("humanTakeoverRequested")).toBe(1);
		expect(bus.listenerCount("agentResumed")).toBe(1);

		await bridge.reinitialize(secondPage as any);
		expect(bus.listenerCount("humanTakeoverRequested")).toBe(1);
		expect(bus.listenerCount("agentResumed")).toBe(1);

		await bridge.requestTakeover("manual");
		await Promise.resolve();
		expect(secondPage.evaluate).toHaveBeenCalledTimes(1);
	});

	it("moves page-close ownership to the current page and disposes when it closes", async () => {
		const bus = new EventBus<TaloxEventMap>();
		const bridge = new TakeoverBridge(bus, 0);
		const firstPage = makePage();
		const secondPage = makePage();

		await bridge.initialize(firstPage as any, true);
		await bridge.reinitialize(secondPage as any);

		expect(firstPage.listenerCount("close")).toBe(0);
		expect(secondPage.listenerCount("close")).toBe(1);

		firstPage.emit("close");
		expect(bus.listenerCount("humanTakeoverRequested")).toBe(1);

		secondPage.emit("close");
		expect(bus.listenerCount("humanTakeoverRequested")).toBe(0);
		expect(bus.listenerCount("agentResumed")).toBe(0);
		expect(secondPage.listenerCount("close")).toBe(0);
		expect(bridge.getState()).toBe("AGENT_RUNNING");
	});

	it("dispose clears an active takeover timeout and owned subscriptions", async () => {
		vi.useFakeTimers();
		const bus = new EventBus<TaloxEventMap>();
		const bridge = new TakeoverBridge(bus, 5_000);
		const page = makePage();

		await bridge.initialize(page as any, true);
		await bridge.requestTakeover("manual");
		expect(vi.getTimerCount()).toBe(1);

		bridge.dispose();

		expect(vi.getTimerCount()).toBe(0);
		expect(bus.listenerCount("humanTakeoverRequested")).toBe(0);
		expect(bus.listenerCount("agentResumed")).toBe(0);
		expect(page.listenerCount("close")).toBe(0);
		expect(bridge.getState()).toBe("AGENT_RUNNING");
	});

	it("replaces the takeover timeout instead of stacking timers", async () => {
		vi.useFakeTimers();
		const bus = new EventBus<TaloxEventMap>();
		const bridge = new TakeoverBridge(bus, 5_000);
		const page = makePage();

		await bridge.initialize(page as any, true);
		await bridge.requestTakeover("first");
		await bridge.requestTakeover("second");

		expect(vi.getTimerCount()).toBe(1);
	});

	it("can subscribe again after page-close disposal", async () => {
		const bus = new EventBus<TaloxEventMap>();
		const bridge = new TakeoverBridge(bus, 0);
		const firstPage = makePage();
		const secondPage = makePage();

		await bridge.initialize(firstPage as any, true);
		firstPage.emit("close");
		expect(bus.listenerCount("humanTakeoverRequested")).toBe(0);

		await bridge.initialize(secondPage as any, true);
		expect(bus.listenerCount("humanTakeoverRequested")).toBe(1);
		expect(bus.listenerCount("agentResumed")).toBe(1);
		expect(secondPage.listenerCount("close")).toBe(1);
	});
});
