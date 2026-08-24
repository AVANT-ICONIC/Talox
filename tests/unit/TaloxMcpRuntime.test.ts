import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaloxController } from "../../src/core/controller/TaloxController.js";
import { TaloxMcpRuntime } from "../../src/core/mcp/TaloxMcpRuntime.js";

function makeController() {
	return {
		launch: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		navigate: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Example" }),
		click: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Example" }),
		type: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Example" }),
		getState: vi.fn().mockResolvedValue({ url: "https://example.com", title: "Example", nodes: [] }),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
	};
}

describe("TaloxMcpRuntime", () => {
	let controller: ReturnType<typeof makeController>;
	let runtime: TaloxMcpRuntime;

	beforeEach(() => {
		controller = makeController();
		runtime = new TaloxMcpRuntime({
			baseDir: "/tmp/talox-mcp-test",
			controllerFactory: () => controller as unknown as TaloxController,
			idFactory: () => "session-1",
			now: () => 1234,
		});
	});

	it("launches headless by default and tracks session metadata", async () => {
		const session = await runtime.launch();

		expect(session).toEqual({
			sessionId: "session-1",
			profileId: "mcp",
			profileClass: "ops",
			browser: "chromium",
			headed: false,
			createdAt: 1234,
		});
		expect(controller.launch).toHaveBeenCalledWith("mcp", "ops", "chromium", { headed: false });
		expect(runtime.listSessions()).toEqual([session]);
		expect(runtime.health().activeSessions).toBe(1);
	});

	it("honors explicit launch options", async () => {
		await runtime.launch({ profileId: "qa-profile", profileClass: "qa", browser: "firefox", headed: true });

		expect(controller.launch).toHaveBeenCalledWith("qa-profile", "qa", "firefox", { headed: true });
	});

	it("reuses daemon command dispatch for browser actions", async () => {
		await runtime.launch();
		const response = await runtime.execute("session-1", "navigate", { url: "https://example.com" }, "request-1");

		expect(response).toEqual({
			id: "request-1",
			success: true,
			data: { url: "https://example.com", title: "Example" },
		});
		expect(controller.navigate).toHaveBeenCalledWith("https://example.com");
	});

	it("returns a structured error for an unknown session", async () => {
		const response = await runtime.execute("missing", "getState", undefined, "request-2");

		expect(response).toEqual({
			id: "request-2",
			success: false,
			error: "Session not found: missing",
		});
	});

	it("stops and forgets one session", async () => {
		await runtime.launch();
		const stopped = await runtime.stop("session-1");

		expect(stopped.sessionId).toBe("session-1");
		expect(controller.stop).toHaveBeenCalledTimes(1);
		expect(runtime.listSessions()).toEqual([]);
	});

	it("cleans up a controller after launch failure", async () => {
		controller.launch.mockRejectedValueOnce(new Error("launch failed"));

		await expect(runtime.launch()).rejects.toThrow("launch failed");
		expect(controller.stop).toHaveBeenCalledTimes(1);
		expect(runtime.listSessions()).toEqual([]);
	});

	it("best-effort stops every active session", async () => {
		const first = makeController();
		const second = makeController();
		second.stop.mockRejectedValueOnce(new Error("already gone"));
		let index = 0;
		const ids = ["one", "two"];
		const controllers = [first, second];
		const multi = new TaloxMcpRuntime({
			controllerFactory: () => controllers[index++] as unknown as TaloxController,
			idFactory: () => ids[index] ?? `session-${index}`,
		});

		await multi.launch();
		await multi.launch();
		await expect(multi.stopAll()).resolves.toBeUndefined();
		expect(first.stop).toHaveBeenCalledTimes(1);
		expect(second.stop).toHaveBeenCalledTimes(1);
		expect(multi.listSessions()).toEqual([]);
	});
});
