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
		fulfill: vi.fn(async () => {}),
	};
}

function makeRequest(url: string) {
	return { url: vi.fn(() => url) };
}

describe("NetworkMocker string pattern semantics", () => {
	it("registers a Playwright matcher that preserves literal substring semantics", async () => {
		const page = makePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });
		const literal = "api.example.com/data?filter=a*b(c)";
		await mocker.addMock({ urlPattern: literal, body: "mocked" });

		const registration = page._registrations[0]!;
		expect(registration.pattern).toBeInstanceOf(RegExp);
		const routePattern = registration.pattern as RegExp;
		expect(routePattern.test(`https://${literal}&page=1`)).toBe(true);
		expect(routePattern.test("https://apiXexampleXcom/dataZfilter=aZZbXcX")).toBe(false);

		const matchingRoute = makeRoute();
		const nonMatchingRoute = makeRoute();
		await registration.handler(matchingRoute, makeRequest(`https://${literal}&page=1`));
		await registration.handler(nonMatchingRoute, makeRequest("https://api.example.com/other"));

		expect(matchingRoute.fulfill).toHaveBeenCalledOnce();
		expect(matchingRoute.continue).not.toHaveBeenCalled();
		expect(nonMatchingRoute.fulfill).not.toHaveBeenCalled();
		expect(nonMatchingRoute.continue).toHaveBeenCalledOnce();
	});

	it("keeps the caller-visible mock pattern unchanged while owning the registered matcher", async () => {
		const page = makePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });
		const mock = { urlPattern: "api.example.com", body: "mocked" };
		await mocker.addMock(mock);
		const registration = page._registrations[0]!;

		expect(mocker.getMocks()).toEqual([mock]);
		expect(registration.pattern).not.toBe(mock.urlPattern);

		await mocker.clearMocks();
		expect(page.unroute).toHaveBeenCalledWith(registration.pattern, registration.handler);
		expect(page._registrations).toHaveLength(0);
	});
});
