import { describe, expect, it, vi } from "vitest";
import { CrossOriginManager } from "../../src/core/CrossOriginManager.js";

function createFrame(name = "child") {
	const parent = {
		name: vi.fn(() => "parent"),
		url: vi.fn(() => "https://parent.example/page"),
		parentFrame: vi.fn(() => null),
	};
	return {
		name: vi.fn(() => name),
		url: vi.fn(() => "https://child.example/embed"),
		parentFrame: vi.fn(() => parent),
	};
}

function createPage(existingFrames: any[] = [], createSession?: (frame: any) => Promise<any>) {
	const listeners = new Map<string, Set<(value: any) => unknown>>();
	const newCDPSession = vi.fn(
		createSession ??
			(async () => ({
				send: vi.fn(async () => ({})),
				detach: vi.fn(async () => undefined),
			})),
	);
	const page = {
		on: vi.fn((event: string, handler: (value: any) => unknown) => {
			const handlers = listeners.get(event) ?? new Set<(value: any) => unknown>();
			handlers.add(handler);
			listeners.set(event, handlers);
			return page;
		}),
		off: vi.fn((event: string, handler: (value: any) => unknown) => {
			listeners.get(event)?.delete(handler);
			return page;
		}),
		frames: vi.fn(() => existingFrames),
		context: vi.fn(() => ({ newCDPSession })),
		_emit: async (event: string, value: any) => {
			await Promise.all([...(listeners.get(event) ?? [])].map((handler) => handler(value)));
		},
	};
	return { page, newCDPSession };
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("CrossOriginManager active-page bootstrap", () => {
	it("bootstraps cross-origin child frames that already exist when installed", async () => {
		const child = createFrame();
		const { page } = createPage([child]);
		const manager = new CrossOriginManager();

		manager.install(page as any);
		await flushAsyncWork();

		expect(manager.getSession("child")).toBeDefined();
	});

	it("does not leak a late CDP session from a page that was already replaced", async () => {
		const child = createFrame("old-child");
		let resolveSession!: (value: any) => void;
		const oldCdp = { send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) };
		const first = createPage([child], () => new Promise((resolve) => (resolveSession = resolve)));
		const second = createPage([]);
		const manager = new CrossOriginManager();

		manager.install(first.page as any);
		manager.install(second.page as any);
		resolveSession(oldCdp);
		await flushAsyncWork();

		expect(manager.getSession("old-child")).toBeUndefined();
		expect(oldCdp.detach).toHaveBeenCalledOnce();
	});

	it("does not let a late pre-navigation session overwrite the newer frame origin", async () => {
		const parent = {
			name: vi.fn(() => "parent"),
			url: vi.fn(() => "https://parent.example/page"),
			parentFrame: vi.fn(() => null),
		};
		let childUrl = "https://old.example/embed";
		const child = {
			name: vi.fn(() => "navigating-child"),
			url: vi.fn(() => childUrl),
			parentFrame: vi.fn(() => parent),
		};
		const sessions = [
			{ send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) },
			{ send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) },
		];
		const resolvers: Array<(value: any) => void> = [];
		const { page, newCDPSession } = createPage(
			[child],
			() => new Promise((resolve) => resolvers.push(resolve)),
		);
		const manager = new CrossOriginManager();

		manager.install(page as any);
		await flushAsyncWork();
		expect(newCDPSession).toHaveBeenCalledTimes(1);

		childUrl = "https://new.example/embed";
		const navigation = page._emit("framenavigated", child);
		await flushAsyncWork();
		expect(newCDPSession).toHaveBeenCalledTimes(2);

		resolvers[1]!(sessions[1]);
		await navigation;
		expect(manager.getSession("navigating-child")?.origin).toBe("https://new.example");

		resolvers[0]!(sessions[0]);
		await flushAsyncWork();

		expect(sessions[0].detach).toHaveBeenCalledOnce();
		expect(sessions[1].detach).not.toHaveBeenCalled();
		expect(manager.getSession("navigating-child")?.cdpSession).toBe(sessions[1]);
		expect(manager.getSession("navigating-child")?.origin).toBe("https://new.example");
	});

	it("keeps only one live CDP session when bootstrap races a frameattached event", async () => {
		const child = createFrame("racy-child");
		const sessions = [
			{ send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) },
			{ send: vi.fn(async () => ({})), detach: vi.fn(async () => undefined) },
		];
		let call = 0;
		const { page, newCDPSession } = createPage([child], async () => sessions[call++]!);
		const manager = new CrossOriginManager();

		manager.install(page as any);
		await page._emit("frameattached", child);
		await flushAsyncWork();

		expect(newCDPSession).toHaveBeenCalledTimes(2);
		expect(manager.getSession("racy-child")).toBeDefined();
		expect(sessions.filter((session) => session.detach.mock.calls.length === 0)).toHaveLength(1);
	});
});
