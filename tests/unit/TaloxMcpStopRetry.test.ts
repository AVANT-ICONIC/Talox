import { describe, expect, it, vi } from "vitest";
import { TaloxMcpSession } from "../../src/core/mcp/TaloxMcpServer.js";

function request(id: number, method: string, params?: Record<string, unknown>) {
	return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

function toolCall(id: number, name: string, args: Record<string, unknown> = {}) {
	return request(id, "tools/call", { name, arguments: args });
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

class RetryController {
	stopCalls = 0;
	stopFailures: Error[] = [];
	stopImplementation: (() => Promise<void>) | null = null;

	async launch() {}

	async stop() {
		this.stopCalls += 1;
		if (this.stopImplementation) return this.stopImplementation();
		const failure = this.stopFailures.shift();
		if (failure) throw failure;
	}

	async navigate(url: string) {
		return { url, title: "Example" };
	}

	async click() {
		return { url: "https://example.com/clicked", title: "Clicked" };
	}

	async type() {
		return { url: "https://example.com/form", title: "Form" };
	}

	async getState() {
		return { url: "https://example.com", title: "Example", nodes: [] };
	}

	async screenshot() {
		return Buffer.from("fake-png");
	}
}

describe("TaloxMcpSession stop retry", () => {
	it("retains the controller after a failed talox_stop so the session can be retried", async () => {
		const controller = new RetryController();
		controller.stopFailures.push(new Error("stop failed"));
		const session = new TaloxMcpSession(() => controller);

		await session.handle(toolCall(1, "talox_launch"));
		const failedStop = await session.handle(toolCall(2, "talox_stop"));

		expect(failedStop).toMatchObject({
			result: {
				isError: true,
				content: [{ type: "text", text: "stop failed" }],
			},
		});
		expect(controller.stopCalls).toBe(1);

		const state = await session.handle(toolCall(3, "talox_state"));
		expect(state).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining("Example") }] } });

		const retryStop = await session.handle(toolCall(4, "talox_stop"));
		expect(retryStop).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining('"stopped": true') }] } });
		expect(controller.stopCalls).toBe(2);

		const noActiveStop = await session.handle(toolCall(5, "talox_stop"));
		expect(noActiveStop).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining('"stopped": false') }] } });
		expect(controller.stopCalls).toBe(2);
	});

	it("retains the controller when session.close fails and succeeds on a later close retry", async () => {
		const controller = new RetryController();
		controller.stopFailures.push(new Error("stop failed"));
		const session = new TaloxMcpSession(() => controller);

		await session.handle(toolCall(1, "talox_launch"));
		await expect(session.close()).rejects.toThrow("stop failed");
		expect(controller.stopCalls).toBe(1);

		await expect(session.close()).resolves.toBeUndefined();
		expect(controller.stopCalls).toBe(2);

		await expect(session.close()).resolves.toBeUndefined();
		expect(controller.stopCalls).toBe(2);
	});

	it("shares one in-flight controller stop across concurrent close calls", async () => {
		const controller = new RetryController();
		const pendingStop = deferred<void>();
		controller.stopImplementation = vi.fn(() => pendingStop.promise);
		const session = new TaloxMcpSession(() => controller);

		await session.handle(toolCall(1, "talox_launch"));
		const firstClose = session.close();
		const secondClose = session.close();
		await Promise.resolve();
		await Promise.resolve();

		expect(controller.stopCalls).toBe(1);
		expect(controller.stopImplementation).toHaveBeenCalledTimes(1);

		pendingStop.resolve();
		await Promise.all([firstClose, secondClose]);

		expect(controller.stopCalls).toBe(1);
		await session.close();
		expect(controller.stopCalls).toBe(1);
	});
});
