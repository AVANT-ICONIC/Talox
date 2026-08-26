import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/controller/EventBus.js";

interface TestEvents {
	ping: { value: number };
}

describe("EventBus off() count ownership", () => {
	it("does not decrement the count when the handler was never registered", () => {
		const bus = new EventBus<TestEvents>();
		const registered = vi.fn();
		const stranger = vi.fn();
		bus.on("ping", registered);

		bus.off("ping", stranger);
		bus.emit("ping", { value: 1 });

		expect(bus.listenerCount("ping")).toBe(1);
		expect(bus.getListenerCounts().get("ping")).toBe(1);
		expect(registered).toHaveBeenCalledOnce();
		expect(stranger).not.toHaveBeenCalled();
	});

	it("still decrements exactly once when a registered handler is removed", () => {
		const bus = new EventBus<TestEvents>();
		const first = vi.fn();
		const second = vi.fn();
		bus.on("ping", first);
		bus.on("ping", second);

		bus.off("ping", first);
		bus.emit("ping", { value: 2 });

		expect(bus.listenerCount("ping")).toBe(1);
		expect(bus.getListenerCounts().get("ping")).toBe(1);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
	});
});
