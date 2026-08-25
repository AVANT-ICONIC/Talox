import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/controller/EventBus.js";
import { ObserveSession } from "../../src/core/observe/ObserveSession.js";
import type { TaloxEventMap } from "../../src/types/events.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("ObserveSession finalization race", () => {
	it("makes an explicit end wait for finalization already started by browser close", async () => {
		let closeHandler: (() => void) | undefined;
		const page = {
			url: vi.fn(() => "https://example.com"),
			on: vi.fn(),
			mainFrame: vi.fn(() => ({ url: () => "https://example.com" })),
			screenshot: vi.fn(() => Promise.resolve(Buffer.from("fake"))),
		};
		const context = {
			on: vi.fn((event: string, handler: () => void) => {
				if (event === "close") closeHandler = handler;
			}),
			close: vi.fn(() => Promise.resolve()),
		};
		const eventBus = new EventBus<TaloxEventMap>();
		const artifactBuilder = { toActionFrames: vi.fn(() => []) };
		const session = new ObserveSession(page as any, context as any, eventBus, artifactBuilder as any, {
			overlay: false,
			record: true,
		});
		const write = deferred<{ json: string }>();
		const reporterWrite = vi.fn(() => write.promise);
		(session as any).reporter.write = reporterWrite;
		const sessionEnd = vi.fn();
		eventBus.on("sessionEnd", sessionEnd);

		await session.start();
		expect(closeHandler).toBeDefined();

		closeHandler?.();
		expect(reporterWrite).toHaveBeenCalledTimes(1);

		let explicitEndResolved = false;
		const explicitEnd = session.endSession().then(() => {
			explicitEndResolved = true;
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(explicitEndResolved).toBe(false);
		expect(sessionEnd).not.toHaveBeenCalled();
		expect(reporterWrite).toHaveBeenCalledTimes(1);

		write.resolve({ json: "/tmp/report.json" });
		await explicitEnd;

		expect(explicitEndResolved).toBe(true);
		expect(sessionEnd).toHaveBeenCalledTimes(1);
		expect(sessionEnd).toHaveBeenCalledWith(expect.objectContaining({ reportPath: "/tmp/report.json" }));

		await session.endSession();
		expect(reporterWrite).toHaveBeenCalledTimes(1);
		expect(sessionEnd).toHaveBeenCalledTimes(1);
	});

	it("allows a failed report write to be retried without duplicating sessionEnd", async () => {
		const page = {
			url: vi.fn(() => "https://example.com"),
			on: vi.fn(),
			mainFrame: vi.fn(() => ({ url: () => "https://example.com" })),
			screenshot: vi.fn(() => Promise.resolve(Buffer.from("fake"))),
		};
		const context = {
			on: vi.fn(),
			close: vi.fn(() => Promise.resolve()),
		};
		const eventBus = new EventBus<TaloxEventMap>();
		const artifactBuilder = { toActionFrames: vi.fn(() => []) };
		const session = new ObserveSession(page as any, context as any, eventBus, artifactBuilder as any, {
			overlay: false,
			record: true,
		});
		const reporterWrite = vi
			.fn()
			.mockRejectedValueOnce(new Error("synthetic report write failure"))
			.mockResolvedValueOnce({ json: "/tmp/retried-report.json" });
		(session as any).reporter.write = reporterWrite;
		const sessionEnd = vi.fn();
		eventBus.on("sessionEnd", sessionEnd);

		await session.start();

		await expect(session.endSession()).rejects.toThrow("synthetic report write failure");
		expect(reporterWrite).toHaveBeenCalledTimes(1);
		expect(sessionEnd).not.toHaveBeenCalled();

		await session.endSession();
		expect(reporterWrite).toHaveBeenCalledTimes(2);
		expect(sessionEnd).toHaveBeenCalledTimes(1);
		expect(sessionEnd).toHaveBeenCalledWith(expect.objectContaining({ reportPath: "/tmp/retried-report.json" }));

		await session.endSession();
		expect(reporterWrite).toHaveBeenCalledTimes(2);
		expect(sessionEnd).toHaveBeenCalledTimes(1);
	});
});
