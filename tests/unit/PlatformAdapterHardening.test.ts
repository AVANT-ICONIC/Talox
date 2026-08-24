import { describe, expect, it } from "vitest";
import { PlatformAdapterRegistry } from "../../src/core/platform/PlatformAdapterRegistry.js";

describe("PlatformAdapterRegistry hardening", () => {
	it("isolates runtime match context between custom adapters", () => {
		const observed: string[] = [];
		const registry = new PlatformAdapterRegistry([
			{
				id: "mutator",
				name: "Mutator",
				kind: "site",
				match: (context) => {
					try {
						(context.search as Record<string, string>).page = "poisoned";
					} catch {
						// Frozen contexts may reject mutation in strict mode.
					}
					return 0.5;
				},
				guidance: ["First."],
			},
			{
				id: "observer",
				name: "Observer",
				kind: "site",
				match: (context) => {
					observed.push(context.search.page ?? "missing");
					return 0.4;
				},
				guidance: ["Second."],
			},
		]);

		registry.match("https://example.com/?page=original");
		expect(observed).toEqual(["original"]);
	});

	it("deep-copies route hints returned by list and match", () => {
		const registry = new PlatformAdapterRegistry([
			{
				id: "routes",
				name: "Routes",
				kind: "site",
				match: () => 1,
				guidance: ["Stable."],
				routes: [{ pattern: "/safe", purpose: "safe purpose" }],
			},
		]);

		const listed = registry.list();
		const listedRoute = listed[0]?.routes?.[0] as { pattern: string; purpose: string } | undefined;
		if (listedRoute) listedRoute.purpose = "mutated";
		expect(registry.list()[0]?.routes?.[0]?.purpose).toBe("safe purpose");

		const matched = registry.match("https://example.com");
		const matchedRoute = matched[0]?.routes?.[0] as { pattern: string; purpose: string } | undefined;
		if (matchedRoute) matchedRoute.purpose = "mutated again";
		expect(registry.match("https://example.com")[0]?.routes?.[0]?.purpose).toBe("safe purpose");
	});

	it("rejects non-finite custom adapter priority", () => {
		const registry = new PlatformAdapterRegistry([]);
		expect(() =>
			registry.register({
				id: "bad-priority",
				name: "Bad Priority",
				kind: "site",
				priority: Number.NaN,
				match: () => 1,
				guidance: ["Nope."],
			}),
		).toThrow(/priority/);
	});
});
