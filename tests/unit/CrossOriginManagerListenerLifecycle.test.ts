import { describe, expect, it, vi } from "vitest";
import { CrossOriginManager } from "../../src/core/CrossOriginManager.js";

function createPage() {
	const listeners = new Map<string, Set<(value: any) => unknown>>();
	const cdp = {
		send: vi.fn(async () => ({})),
		detach: vi.fn(async () => undefined),
	};
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
		context: vi.fn(() => ({ newCDPSession: vi.fn(async () => cdp) })),
		_emit: async (event: string, value: any) => {
			await Promise.all([...(listeners.get(event) ?? [])].map((handler) => handler(value)));
		},
		_listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
	};
	return { page, cdp };
}

function createCrossOriginFrame(name = "child") {
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

describe("CrossOriginManager page listener lifecycle", () => {
	it("installs one listener set per page and treats repeated install as idempotent", () => {
		const manager = new CrossOriginManager();
		const { page } = createPage();

		manager.install(page as any);
		manager.install(page as any);

		expect(page.on).toHaveBeenCalledTimes(3);
		expect(page._listenerCount("frameattached")).toBe(1);
		expect(page._listenerCount("framenavigated")).toBe(1);
		expect(page._listenerCount("framedetached")).toBe(1);
	});

	it("removes all page listeners on dispose and ignores later frame events", async () => {
		const manager = new CrossOriginManager();
		const { page } = createPage();
		manager.install(page as any);
		manager.dispose();

		expect(page.off).toHaveBeenCalledTimes(3);
		expect(page._listenerCount("frameattached")).toBe(0);
		expect(page._listenerCount("framenavigated")).toBe(0);
		expect(page._listenerCount("framedetached")).toBe(0);

		await page._emit("frameattached", createCrossOriginFrame());
		expect(manager.getAllSessions()).toEqual([]);
	});

	it("detaches old sessions and listeners when moved to a new page", async () => {
		const manager = new CrossOriginManager();
		const first = createPage();
		const second = createPage();
		manager.install(first.page as any);
		await first.page._emit("frameattached", createCrossOriginFrame("old-child"));
		expect(manager.getSession("old-child")).toBeDefined();

		manager.install(second.page as any);

		expect(first.cdp.detach).toHaveBeenCalledTimes(1);
		expect(manager.getSession("old-child")).toBeUndefined();
		expect(first.page.off).toHaveBeenCalledTimes(3);
		expect(second.page.on).toHaveBeenCalledTimes(3);
	});
});
