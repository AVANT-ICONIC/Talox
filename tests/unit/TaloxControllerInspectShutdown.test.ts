import { describe, expect, it, vi } from "vitest";
import { TaloxController } from "../../src/core/controller/TaloxController.js";

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("TaloxController inspect shutdown", () => {
	it("waits for inspect socket release before finishing session shutdown", async () => {
		const controller = new TaloxController();
		const gate = deferred<void>();
		const inspectServer = { detach: vi.fn(() => gate.promise) };
		(controller as any).inspectServer = inspectServer;
		const sessionStop = vi.spyOn(controller._session, "stop").mockResolvedValue(undefined);

		let resolved = false;
		const stop = controller.stop().then(() => {
			resolved = true;
		});

		await vi.waitFor(() => expect(inspectServer.detach).toHaveBeenCalledTimes(1));
		expect(sessionStop).not.toHaveBeenCalled();
		expect(resolved).toBe(false);

		gate.resolve();
		await stop;

		expect(sessionStop).toHaveBeenCalledTimes(1);
		expect(resolved).toBe(true);
	});
});
