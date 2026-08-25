import { describe, expect, it, vi } from "vitest";
import type { DaemonCommand, DaemonResponse } from "../../src/core/daemon/TaloxDaemon.js";
import { TaloxDaemon } from "../../src/core/daemon/TaloxDaemon.js";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

type TestController = {
	stop: ReturnType<typeof vi.fn>;
};

type TestSession = {
	id: string;
	controller: TestController;
	createdAt: number;
};

type DaemonState = {
	sessions: Map<string, TestSession>;
	launchTasks: Set<Promise<void>>;
	server: { close: ReturnType<typeof vi.fn> } | null;
	running: boolean;
	handleStop(command: DaemonCommand): Promise<DaemonResponse>;
};

function runningDaemon() {
	const daemon = new TaloxDaemon();
	const state = daemon as unknown as DaemonState;
	const server = {
		close: vi.fn((callback: (error?: Error) => void) => callback()),
	};
	state.server = server;
	state.running = true;
	return { daemon, state, server };
}

function addSession(state: DaemonState, id: string, stop: ReturnType<typeof vi.fn>) {
	state.sessions.set(id, { id, controller: { stop }, createdAt: Date.now() });
}

describe("TaloxDaemon shutdown retry", () => {
	it("removes successful sessions but retains failed sessions and the server for retry", async () => {
		const { daemon, state, server } = runningDaemon();
		const successfulStop = vi.fn().mockResolvedValue(undefined);
		const failedStop = vi.fn().mockRejectedValueOnce(new Error("browser still alive")).mockResolvedValue(undefined);
		addSession(state, "ok", successfulStop);
		addSession(state, "retry", failedStop);

		await expect(daemon.stop()).rejects.toThrow("Failed to stop 1 daemon session");

		expect(successfulStop).toHaveBeenCalledTimes(1);
		expect(failedStop).toHaveBeenCalledTimes(1);
		expect(state.sessions.has("ok")).toBe(false);
		expect(state.sessions.has("retry")).toBe(true);
		expect(daemon.isRunning()).toBe(true);
		expect(server.close).not.toHaveBeenCalled();

		await expect(daemon.stop()).resolves.toBeUndefined();

		expect(successfulStop).toHaveBeenCalledTimes(1);
		expect(failedStop).toHaveBeenCalledTimes(2);
		expect(state.sessions.size).toBe(0);
		expect(daemon.isRunning()).toBe(false);
		expect(server.close).toHaveBeenCalledTimes(1);
	});

	it("shares one global shutdown attempt across concurrent stop calls", async () => {
		const { daemon, state, server } = runningDaemon();
		const gate = deferred<void>();
		const stop = vi.fn(() => gate.promise);
		addSession(state, "shared", stop);

		const first = daemon.stop();
		const second = daemon.stop();
		await Promise.resolve();
		await Promise.resolve();

		expect(stop).toHaveBeenCalledTimes(1);
		expect(server.close).not.toHaveBeenCalled();

		gate.resolve();
		await Promise.all([first, second]);

		expect(stop).toHaveBeenCalledTimes(1);
		expect(server.close).toHaveBeenCalledTimes(1);
		expect(daemon.isRunning()).toBe(false);
	});

	it("shares a per-session stop between a stop command and global shutdown", async () => {
		const { daemon, state, server } = runningDaemon();
		const gate = deferred<void>();
		const stop = vi.fn(() => gate.promise);
		addSession(state, "session-a", stop);

		const commandStop = state.handleStop({ id: "cmd-stop", action: "stop", params: { sessionId: "session-a" } });
		const globalStop = daemon.stop();
		await Promise.resolve();
		await Promise.resolve();

		expect(stop).toHaveBeenCalledTimes(1);

		gate.resolve();
		const [response] = await Promise.all([commandStop, globalStop]);

		expect(response).toEqual({ id: "cmd-stop", success: true, data: { stopped: "session-a" } });
		expect(stop).toHaveBeenCalledTimes(1);
		expect(state.sessions.size).toBe(0);
		expect(server.close).toHaveBeenCalledTimes(1);
	});

	it("waits for a launch already in progress before taking the shutdown session snapshot", async () => {
		const { daemon, state, server } = runningDaemon();
		const launchGate = deferred<void>();
		const launchedStop = vi.fn().mockResolvedValue(undefined);
		const launchTask = (async () => {
			await launchGate.promise;
			addSession(state, "late-session", launchedStop);
		})();
		state.launchTasks.add(launchTask);

		const shutdown = daemon.stop();
		await Promise.resolve();
		expect(server.close).not.toHaveBeenCalled();
		expect(launchedStop).not.toHaveBeenCalled();

		launchGate.resolve();
		await shutdown;

		expect(launchedStop).toHaveBeenCalledTimes(1);
		expect(state.sessions.size).toBe(0);
		expect(server.close).toHaveBeenCalledTimes(1);
		expect(daemon.isRunning()).toBe(false);
	});
});
