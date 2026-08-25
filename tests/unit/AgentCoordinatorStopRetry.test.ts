import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCoordinator } from "../../src/core/AgentCoordinator.js";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("AgentCoordinator stop recovery", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("retains only agents whose stop failed and retries them later", async () => {
		vi.spyOn(TaloxController.prototype, "launch").mockResolvedValue(undefined);
		const stop = vi.spyOn(TaloxController.prototype, "stop");
		stop.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("synthetic agent-1 stop failure"));

		const coordinator = new AgentCoordinator({ agents: 2, baseDir: "/tmp/talox-coordinator-stop-retry" });
		await coordinator.launch({ profileClass: "sandbox" });

		await expect(coordinator.stop()).rejects.toThrow("agent 1: synthetic agent-1 stop failure");
		expect(coordinator.getAgent(0)).toBeUndefined();
		expect(coordinator.getAgent(1)).toBeDefined();
		await expect(coordinator.run([])).rejects.toThrow("Coordinator not launched");
		await expect(coordinator.launch({ profileClass: "sandbox" })).rejects.toThrow("agents awaiting cleanup");

		stop.mockResolvedValueOnce(undefined);
		await coordinator.stop();
		expect(stop).toHaveBeenCalledTimes(3);
		expect(coordinator.getAgent(0)).toBeUndefined();
		expect(coordinator.getAgent(1)).toBeUndefined();
	});

	it("shares one shutdown attempt across concurrent stop callers", async () => {
		vi.spyOn(TaloxController.prototype, "launch").mockResolvedValue(undefined);
		const pendingStop = deferred<void>();
		const stop = vi.spyOn(TaloxController.prototype, "stop").mockReturnValue(pendingStop.promise);

		const coordinator = new AgentCoordinator({ agents: 1, baseDir: "/tmp/talox-coordinator-stop-single-flight" });
		await coordinator.launch({ profileClass: "sandbox" });

		const first = coordinator.stop();
		const second = coordinator.stop();
		expect(second).toBe(first);
		expect(stop).toHaveBeenCalledTimes(1);

		pendingStop.resolve();
		await first;
		expect(coordinator.getAgent(0)).toBeUndefined();
	});

	it("keeps a controller reachable when rollback after launch failure cannot stop it", async () => {
		const launch = vi.spyOn(TaloxController.prototype, "launch");
		launch.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("synthetic second-agent launch failure"));
		const stop = vi.spyOn(TaloxController.prototype, "stop");
		stop.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("synthetic rollback stop failure"));

		const coordinator = new AgentCoordinator({ agents: 2, baseDir: "/tmp/talox-coordinator-launch-rollback" });

		await expect(coordinator.launch({ profileClass: "sandbox" })).rejects.toThrow(
			"synthetic second-agent launch failure",
		);
		expect(stop).toHaveBeenCalledTimes(2);
		expect(coordinator.getAgent(0)).toBeUndefined();
		expect(coordinator.getAgent(1)).toBeDefined();
		await expect(coordinator.launch({ profileClass: "sandbox" })).rejects.toThrow("agents awaiting cleanup");

		stop.mockResolvedValueOnce(undefined);
		await coordinator.stop();
		expect(coordinator.getAgent(1)).toBeUndefined();
	});

	it("preserves the original launch error when rollback also fails", async () => {
		vi.spyOn(TaloxController.prototype, "launch").mockRejectedValueOnce(new Error("primary launch failure"));
		vi.spyOn(TaloxController.prototype, "stop").mockRejectedValueOnce(new Error("secondary cleanup failure"));

		const coordinator = new AgentCoordinator({ agents: 1, baseDir: "/tmp/talox-coordinator-error-priority" });

		await expect(coordinator.launch({ profileClass: "sandbox" })).rejects.toThrow("primary launch failure");
		expect(coordinator.getAgent(0)).toBeDefined();
	});
});
