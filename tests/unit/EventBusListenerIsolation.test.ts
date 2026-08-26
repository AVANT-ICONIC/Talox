import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/controller/EventBus.js";

interface TestEvents {
	work: { id: number };
	error: { message: string; stack?: string };
}

describe("EventBus listener failure isolation", () => {
	it("continues to later listeners when an earlier listener throws", () => {
		const bus = new EventBus<TestEvents>();
		const later = vi.fn();
		bus.on("error", vi.fn());
		bus.on("work", () => {
			throw new Error("first listener failed");
		});
		bus.on("work", later);

		expect(() => bus.emit("work", { id: 1 })).not.toThrow();
		expect(later).toHaveBeenCalledOnce();
		expect(later).toHaveBeenCalledWith({ id: 1 });
	});

	it("reports a listener failure to error listeners without blocking the original event", () => {
		const bus = new EventBus<TestEvents>();
		const errorListener = vi.fn();
		const later = vi.fn();
		bus.on("error", errorListener);
		bus.on("work", () => {
			throw new Error("synthetic work failure");
		});
		bus.on("work", later);

		bus.emit("work", { id: 2 });

		expect(errorListener).toHaveBeenCalledOnce();
		expect(errorListener).toHaveBeenCalledWith(
			expect.objectContaining({ message: "synthetic work failure" }),
		);
		expect(later).toHaveBeenCalledOnce();
	});

	it("isolates failures between error listeners too", () => {
		const bus = new EventBus<TestEvents>();
		const survivingErrorListener = vi.fn();
		const laterWorkListener = vi.fn();
		bus.on("error", () => {
			throw new Error("broken error observer");
		});
		bus.on("error", survivingErrorListener);
		bus.on("work", () => {
			throw new Error("original failure");
		});
		bus.on("work", laterWorkListener);

		expect(() => bus.emit("work", { id: 3 })).not.toThrow();
		expect(survivingErrorListener).toHaveBeenCalledOnce();
		expect(survivingErrorListener).toHaveBeenCalledWith(
			expect.objectContaining({ message: "original failure" }),
		);
		expect(laterWorkListener).toHaveBeenCalledOnce();
	});

	it("preserves once semantics and listener counts when a once listener throws", () => {
		const bus = new EventBus<TestEvents>();
		const onceListener = vi.fn(() => {
			throw new Error("one-shot failure");
		});
		const persistent = vi.fn();
		bus.on("error", vi.fn());
		bus.once("work", onceListener);
		bus.on("work", persistent);

		bus.emit("work", { id: 4 });
		bus.emit("work", { id: 5 });

		expect(onceListener).toHaveBeenCalledOnce();
		expect(persistent).toHaveBeenCalledTimes(2);
		expect(bus.listenerCount("work")).toBe(1);
		expect(bus.getListenerCounts().get("work")).toBe(1);
	});
});
