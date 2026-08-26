import { describe, expect, it, vi } from "vitest";
import { NetworkMocker } from "../../src/core/NetworkMocker.js";

type Handler = (route: any, request: any) => Promise<void>;

function makePage() {
	const registrations: Array<{ pattern: string | RegExp; handler: Handler }> = [];
	return {
		route: vi.fn(async (pattern: string | RegExp, handler: Handler) => {
			registrations.push({ pattern, handler });
		}),
		unroute: vi.fn(async (pattern: string | RegExp, handler: Handler) => {
			const index = registrations.findIndex((entry) => entry.pattern === pattern && entry.handler === handler);
			if (index >= 0) registrations.splice(index, 1);
		}),
		_registrations: registrations,
	};
}

function makeRoute() {
	return {
		continue: vi.fn(async () => {}),
		fallback: vi.fn(async () => {}),
		fulfill: vi.fn(async () => {}),
	};
}

function makeRequest(url: string) {
	return { url: vi.fn(() => url) };
}

describe("NetworkMocker stateful RegExp ownership", () => {
	it("normalizes a global RegExp so repeated identical requests match deterministically", async () => {
		const page = makePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });
		const original = /api\.example\.com\/data/g;
		await mocker.addMock({ urlPattern: original, body: "mocked" });

		const registration = page._registrations[0]!;
		expect(registration.pattern).toBeInstanceOf(RegExp);
		expect(registration.pattern).not.toBe(original);
		expect((registration.pattern as RegExp).global).toBe(false);
		expect((registration.pattern as RegExp).source).toBe(original.source);

		const firstRoute = makeRoute();
		const secondRoute = makeRoute();
		const request = makeRequest("https://api.example.com/data");
		await registration.handler(firstRoute, request);
		await registration.handler(secondRoute, request);

		expect(firstRoute.fulfill).toHaveBeenCalledOnce();
		expect(secondRoute.fulfill).toHaveBeenCalledOnce();
		expect(firstRoute.continue).not.toHaveBeenCalled();
		expect(secondRoute.continue).not.toHaveBeenCalled();
		expect(firstRoute.fallback).not.toHaveBeenCalled();
		expect(secondRoute.fallback).not.toHaveBeenCalled();
		expect(original.lastIndex).toBe(0);
	});

	it("normalizes a sticky RegExp without losing its start-of-URL semantics", async () => {
		const page = makePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });
		const original = /https:\/\/api\.example\.com\/data/y;
		await mocker.addMock({ urlPattern: original, body: "mocked" });

		const registration = page._registrations[0]!;
		const routePattern = registration.pattern as RegExp;
		expect(routePattern.sticky).toBe(false);
		expect(routePattern.source.startsWith("^(?:")).toBe(true);

		const matchingRoute = makeRoute();
		const shiftedRoute = makeRoute();
		await registration.handler(matchingRoute, makeRequest("https://api.example.com/data"));
		await registration.handler(shiftedRoute, makeRequest("xhttps://api.example.com/data"));

		expect(matchingRoute.fulfill).toHaveBeenCalledOnce();
		expect(shiftedRoute.fulfill).not.toHaveBeenCalled();
		expect(shiftedRoute.fallback).toHaveBeenCalledOnce();
		expect(shiftedRoute.continue).not.toHaveBeenCalled();
		expect(original.lastIndex).toBe(0);
	});

	it("unroutes the exact normalized RegExp object that was registered", async () => {
		const page = makePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });
		const original = /api\.example\.com/g;
		await mocker.addMock({ urlPattern: original, body: "mocked" });
		const registration = page._registrations[0]!;

		await mocker.clearMocks();

		expect(page.unroute).toHaveBeenCalledWith(registration.pattern, registration.handler);
		expect(page._registrations).toHaveLength(0);
		expect(mocker.getMocks()).toEqual([]);
	});
});
