import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("TaloxController stop retry", () => {
	it("surfaces SessionManager stop failures and retries on a later stop", async () => {
		const controller = new TaloxController();
		const failure = new Error("browser close failed");
		const sessionStop = vi
			.spyOn(controller._session, "stop")
			.mockRejectedValueOnce(failure)
			.mockResolvedValue(undefined);

		await expect(controller.stop()).rejects.toBe(failure);
		expect(sessionStop).toHaveBeenCalledTimes(1);

		await expect(controller.stop()).resolves.toBeUndefined();
		expect(sessionStop).toHaveBeenCalledTimes(2);
	});

	it("shares one in-flight SessionManager stop across concurrent callers", async () => {
		const controller = new TaloxController();
		const gate = deferred<void>();
		const sessionStop = vi.spyOn(controller._session, "stop").mockImplementation(() => gate.promise);

		const firstStop = controller.stop();
		const secondStop = controller.stop();
		await vi.waitFor(() => expect(sessionStop).toHaveBeenCalledTimes(1));

		gate.resolve();
		await Promise.all([firstStop, secondStop]);

		expect(sessionStop).toHaveBeenCalledTimes(1);
	});
});
