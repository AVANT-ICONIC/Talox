import { afterEach, describe, expect, it } from "vitest";
import {
	BUILT_IN_WARMUPS,
	SiteWarmupRegistry,
	type WarmupStrategy,
} from "../../src/core/SiteWarmup.js";

const originalExportedEntries = Array.from(BUILT_IN_WARMUPS.entries());

afterEach(() => {
	BUILT_IN_WARMUPS.clear();
	for (const [hostname, strategy] of originalExportedEntries) {
		BUILT_IN_WARMUPS.set(hostname, strategy);
	}
});

describe("SiteWarmupRegistry default isolation", () => {
	it("does not let mutations of the exported built-in map alter future default registries", () => {
		BUILT_IN_WARMUPS.clear();
		BUILT_IN_WARMUPS.set("poisoned.example", {
			name: "poisoned",
			detect: () => true,
			warmup: async () => {},
		});

		const registry = new SiteWarmupRegistry();

		expect(registry.getWarmup("reddit.com")?.name).toBe("reddit-humanity-challenge");
		expect(registry.getWarmup("unknown.example")?.name).toBe("cloudflare-challenge");
		expect(registry.getWarmup("poisoned.example")?.name).toBe("cloudflare-challenge");
	});

	it("gives each default registry independent built-in strategy objects", () => {
		const registryA = new SiteWarmupRegistry();
		const registryB = new SiteWarmupRegistry();
		const redditA = registryA.getWarmup("reddit.com")!;
		const redditB = registryB.getWarmup("reddit.com")!;

		expect(redditA).not.toBe(redditB);
		redditA.name = "mutated-in-a";

		expect(registryA.getWarmup("reddit.com")?.name).toBe("mutated-in-a");
		expect(registryB.getWarmup("reddit.com")?.name).toBe("reddit-humanity-challenge");
		expect(new SiteWarmupRegistry().getWarmup("reddit.com")?.name).toBe("reddit-humanity-challenge");
	});

	it("preserves caller-provided custom strategy identity", () => {
		const custom: WarmupStrategy = {
			name: "custom",
			detect: () => false,
			warmup: async () => {},
		};
		const registry = new SiteWarmupRegistry(new Map([["custom.example", custom]]));

		expect(registry.getWarmup("custom.example")).toBe(custom);
	});
});
