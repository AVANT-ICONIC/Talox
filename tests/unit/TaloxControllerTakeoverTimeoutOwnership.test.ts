import { afterEach, describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function makePage() {
	const listeners = new Map<string, Set<(...args: any[]) => void>>();
	const page = {
		addInitScript: vi.fn().mockResolvedValue(undefined),
		exposeFunction: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockResolvedValue(undefined),
		url: vi.fn().mockReturnValue("https://example.com"),
		on: vi.fn((event: string, handler: (...args: any[]) => void) => {
			const handlers = listeners.get(event) ?? new Set<(...args: any[]) => void>();
			handlers.add(handler);
			listeners.set(event, handlers);
			return page;
		}),
		off: vi.fn((event: string, handler: (...args: any[]) => void) => {
			listeners.get(event)?.delete(handler);
			return page;
		}),
		emit: (event: string, ...args: any[]) => {
			for (const handler of [...(listeners.get(event) ?? [])]) handler(...args);
		},
	};
	return page;
}

async function makeController(timeoutMs = 500) {
	const controller = new TaloxController(".", { humanTakeover: { timeoutMs } });
	const page = makePage();
	await controller._takeover.initialize(page as any, true);
	return { controller, page };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("TaloxController takeover timeout ownership", () => {
	it("uses the bridge as the sole timeout owner and emits one timeout resume", async () => {
		vi.useFakeTimers();
		const { controller } = await makeController();
		const resumed = vi.fn();
		controller.on("agentResumed", resumed);

		const pending = controller.requestHumanTakeover("manual");
		expect(controller.getTakeoverState()).toBe("WAITING_FOR_HUMAN");
		expect(vi.getTimerCount()).toBe(1);

		await vi.advanceTimersByTimeAsync(500);
		await pending;

		expect(controller.getTakeoverState()).toBe("AGENT_RUNNING");
		expect(resumed).toHaveBeenCalledTimes(1);
		expect(resumed).toHaveBeenCalledWith(expect.objectContaining({ reason: "timeout" }));
		expect(vi.getTimerCount()).toBe(0);

		await vi.advanceTimersByTimeAsync(500);
		expect(resumed).toHaveBeenCalledTimes(1);
	});

	it("manual resume settles the pending takeover and clears the bridge timeout", async () => {
		vi.useFakeTimers();
		const { controller } = await makeController();
		const resumed = vi.fn();
		controller.on("agentResumed", resumed);

		const pending = controller.requestHumanTakeover("manual");
		expect(vi.getTimerCount()).toBe(1);

		controller.resumeAgent();
		await pending;

		expect(controller.getTakeoverState()).toBe("AGENT_RUNNING");
		expect(resumed).toHaveBeenCalledTimes(1);
		expect(resumed).toHaveBeenCalledWith(expect.objectContaining({ reason: "manual" }));
		expect(vi.getTimerCount()).toBe(0);
	});

	it("successful stop settles a pending takeover without a delayed resume event", async () => {
		vi.useFakeTimers();
		const { controller } = await makeController();
		vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);
		const resumed = vi.fn();
		controller.on("agentResumed", resumed);

		const pending = controller.requestHumanTakeover("manual");
		expect(vi.getTimerCount()).toBe(1);

		await controller.stop();
		await pending;

		expect(controller.getTakeoverState()).toBe("AGENT_RUNNING");
		expect(vi.getTimerCount()).toBe(0);
		expect(resumed).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1_000);
		expect(resumed).not.toHaveBeenCalled();
	});

	it("keeps takeover state alive when session shutdown fails and cleans it on retry", async () => {
		vi.useFakeTimers();
		const { controller } = await makeController(5_000);
		const shutdownFailure = new Error("browser still open");
		vi.spyOn(controller._session, "stop").mockRejectedValueOnce(shutdownFailure).mockResolvedValueOnce(undefined);

		let settled = false;
		const pending = controller.requestHumanTakeover("manual").then(() => {
			settled = true;
		});
		expect(vi.getTimerCount()).toBe(1);

		await expect(controller.stop()).rejects.toBe(shutdownFailure);
		expect(controller.getTakeoverState()).toBe("WAITING_FOR_HUMAN");
		expect(vi.getTimerCount()).toBe(1);
		expect(settled).toBe(false);

		await controller.stop();
		await pending;

		expect(controller.getTakeoverState()).toBe("AGENT_RUNNING");
		expect(vi.getTimerCount()).toBe(0);
		expect(settled).toBe(true);
	});
});
