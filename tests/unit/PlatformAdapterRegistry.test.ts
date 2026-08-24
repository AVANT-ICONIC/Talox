import { describe, expect, it } from "vitest";
import {
	PlatformAdapterRegistry,
	getPlatformAdapterContext,
	matchPlatformAdapters,
} from "../../src/core/platform/PlatformAdapterRegistry.js";

describe("PlatformAdapterRegistry", () => {
	it("detects WordPress admin routes", () => {
		const matches = matchPlatformAdapters("https://example.com/wp-admin/edit.php");
		expect(matches.map((match) => match.adapterId)).toContain("wordpress-admin");
	});

	it("layers WooCommerce guidance over WordPress guidance", () => {
		const matches = matchPlatformAdapters("https://shop.example/wp-admin/edit.php?post_type=product");
		expect(matches[0]?.adapterId).toBe("woocommerce-admin");
		expect(matches.map((match) => match.adapterId)).toContain("wordpress-admin");
	});

	it("detects Shopify Admin", () => {
		expect(matchPlatformAdapters("https://admin.shopify.com/store/acme/products")[0]?.adapterId).toBe("shopify-admin");
		expect(matchPlatformAdapters("https://acme.myshopify.com/admin/products")[0]?.adapterId).toBe("shopify-admin");
	});

	it("detects GitHub and Slack", () => {
		expect(matchPlatformAdapters("https://github.com/AVANT-ICONIC/Talox/pulls")[0]?.adapterId).toBe("github");
		expect(matchPlatformAdapters("https://app.slack.com/client/T123/C456")[0]?.adapterId).toBe("slack-web");
	});

	it("returns no match for unrelated or non-http URLs", () => {
		expect(matchPlatformAdapters("https://example.com/dashboard")).toEqual([]);
		expect(matchPlatformAdapters("about:blank")).toEqual([]);
		expect(matchPlatformAdapters("not a url")).toEqual([]);
	});

	it("renders concise planner context", () => {
		const context = getPlatformAdapterContext("https://example.com/wp-admin/plugins.php");
		expect(context).toContain("# Platform Adapter Context");
		expect(context).toContain("WordPress Admin");
		expect(context).toContain("current Talox state");
		expect(context).toContain("/wp-admin/plugins.php");
	});

	it("rejects duplicate adapter ids transactionally", () => {
		const registry = new PlatformAdapterRegistry([]);
		const adapter = {
			id: "example",
			name: "Example",
			kind: "site" as const,
			match: () => 1,
			guidance: ["Use live state."],
		};
		registry.register(adapter);
		expect(() => registry.register(adapter)).toThrow(/already registered/);
		expect(registry.list()).toHaveLength(1);
	});

	it("isolates throwing custom adapters", () => {
		const registry = new PlatformAdapterRegistry([
			{
				id: "broken",
				name: "Broken",
				kind: "site",
				match: () => {
					throw new Error("boom");
				},
				guidance: ["Never reached."],
			},
			{
				id: "healthy",
				name: "Healthy",
				kind: "site",
				match: ({ hostname }) => (hostname === "example.com" ? 0.8 : 0),
				guidance: ["Healthy hint."],
			},
		]);
		expect(registry.match("https://example.com").map((match) => match.adapterId)).toEqual(["healthy"]);
	});

	it("ignores invalid custom confidence values", () => {
		const registry = new PlatformAdapterRegistry([
			{
				id: "nan",
				name: "NaN",
				kind: "site",
				match: () => Number.NaN,
				guidance: ["Nope."],
			},
			{
				id: "too-high",
				name: "Too High",
				kind: "site",
				match: () => 2,
				guidance: ["Nope."],
			},
		]);
		expect(registry.match("https://example.com")).toEqual([]);
	});

	it("returns defensive copies from list and match", () => {
		const registry = new PlatformAdapterRegistry();
		const listed = registry.list();
		const originalLength = registry.list()[0]?.guidance.length;
		(listed[0]?.guidance as string[] | undefined)?.push("mutated");
		expect(registry.list()[0]?.guidance).toHaveLength(originalLength ?? 0);

		const matches = registry.match("https://github.com/openai/openai");
		(matches[0]?.guidance as string[] | undefined)?.push("mutated");
		expect(registry.match("https://github.com/openai/openai")[0]?.guidance).not.toContain("mutated");
	});
});
