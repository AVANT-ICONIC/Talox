/**
 * Unit tests for SiteWarmup — generic site warmup registry.
 */
import { describe, expect, it, vi } from "vitest";
import {
	BUILT_IN_WARMUPS,
	type WarmupStrategy,
	SiteWarmupRegistry,
	cloudflareWarmup,
	genericVerificationWarmup,
	redditWarmup,
} from "../../src/core/SiteWarmup.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockPage(title = "Normal Page", bodyHtml = "") {
	return {
		title: vi.fn().mockResolvedValue(title),
		goto: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockImplementation((fn: any) => {
			// Simulate page.evaluate by calling the function with a fake body
			if (bodyHtml) {
				return fn();
			}
			return false;
		}),
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SiteWarmupRegistry", () => {
	describe("constructor", () => {
		it("initializes with built-in warmups by default", () => {
			const registry = new SiteWarmupRegistry();
			expect(registry.getWarmup("reddit.com")).toBeDefined();
			expect(registry.getWarmup("www.reddit.com")).toBeDefined();
			expect(registry.getWarmup("cloudflare.com")).toBeDefined();
			expect(registry.getWarmup("example.com")).toBeDefined(); // wildcard
		});

		it("accepts custom warmups map", () => {
			const customMap = new Map<string, WarmupStrategy>();
			const strategy: WarmupStrategy = {
				name: "custom",
				detect: () => false,
				warmup: async () => {},
			};
			customMap.set("custom.com", strategy);

			const registry = new SiteWarmupRegistry(customMap);
			expect(registry.getWarmup("custom.com")).toBe(strategy);
			expect(registry.getWarmup("reddit.com")).toBeUndefined();
		});
	});

	describe("register", () => {
		it("registers a new warmup strategy", () => {
			const registry = new SiteWarmupRegistry();
			const strategy: WarmupStrategy = {
				name: "test",
				detect: () => true,
				warmup: async () => {},
			};

			registry.register("test.com", strategy);
			expect(registry.getWarmup("test.com")).toBe(strategy);
		});

		it("overwrites an existing warmup", () => {
			const registry = new SiteWarmupRegistry();
			const strategy1: WarmupStrategy = {
				name: "v1",
				detect: () => false,
				warmup: async () => {},
			};
			const strategy2: WarmupStrategy = {
				name: "v2",
				detect: () => true,
				warmup: async () => {},
			};

			registry.register("test.com", strategy1);
			registry.register("test.com", strategy2);
			expect(registry.getWarmup("test.com")!.name).toBe("v2");
		});
	});

	describe("getWarmup", () => {
		it("returns exact match", () => {
			const registry = new SiteWarmupRegistry();
			const result = registry.getWarmup("reddit.com");
			expect(result).toBeDefined();
			expect(result!.name).toBe("reddit-humanity-challenge");
		});

		it("resolves subdomain to parent domain", () => {
			const registry = new SiteWarmupRegistry();
			const result = registry.getWarmup("www.reddit.com");
			expect(result).toBeDefined();
			expect(result!.name).toBe("reddit-humanity-challenge");
		});

		it("resolves deep subdomains", () => {
			const registry = new SiteWarmupRegistry();
			const result = registry.getWarmup("old.www.reddit.com");
			expect(result).toBeDefined();
			expect(result!.name).toBe("reddit-humanity-challenge");
		});

		it("returns wildcard for unknown domains", () => {
			const registry = new SiteWarmupRegistry();
			const result = registry.getWarmup("unknown.com");
			expect(result).toBeDefined();
			expect(result!.name).toBe("cloudflare-challenge");
		});

		it("returns undefined when no match and no wildcard", () => {
			const registry = new SiteWarmupRegistry(new Map());
			const result = registry.getWarmup("unknown.com");
			expect(result).toBeUndefined();
		});

		it("prefers exact match over wildcard", () => {
			const registry = new SiteWarmupRegistry();
			const custom: WarmupStrategy = {
				name: "custom-cloudflare",
				detect: () => true,
				warmup: async () => {},
			};
			registry.register("cloudflare.com", custom);

			const result = registry.getWarmup("cloudflare.com");
			expect(result!.name).toBe("custom-cloudflare");
		});
	});

	describe("has", () => {
		it("returns true for registered hostnames", () => {
			const registry = new SiteWarmupRegistry();
			expect(registry.has("reddit.com")).toBe(true);
		});

		it("returns true for subdomains of registered hostnames", () => {
			const registry = new SiteWarmupRegistry();
			expect(registry.has("www.reddit.com")).toBe(true);
		});

		it("returns true for wildcard fallback", () => {
			const registry = new SiteWarmupRegistry();
			expect(registry.has("anything.com")).toBe(true);
		});

		it("returns false when no match and no wildcard", () => {
			const registry = new SiteWarmupRegistry(new Map());
			expect(registry.has("anything.com")).toBe(false);
		});
	});

	describe("unregister", () => {
		it("removes a registered strategy", () => {
			const registry = new SiteWarmupRegistry();
			expect(registry.has("reddit.com")).toBe(true);
			const result = registry.unregister("reddit.com");
			expect(result).toBe(true);
			// After removing reddit.com, www.reddit.com falls through to wildcard
			expect(registry.getWarmup("reddit.com")!.name).toBe("cloudflare-challenge");
		});

		it("returns false for non-existent hostname", () => {
			const registry = new SiteWarmupRegistry(new Map());
			expect(registry.unregister("nonexistent.com")).toBe(false);
		});
	});

	describe("keys", () => {
		it("lists all registered keys", () => {
			const registry = new SiteWarmupRegistry();
			const keys = registry.keys();
			expect(keys).toContain("reddit.com");
			expect(keys).toContain("cloudflare.com");
			expect(keys).toContain("*");
		});
	});

	describe("runIfNeeded", () => {
		it("returns false when no strategy is registered", async () => {
			const registry = new SiteWarmupRegistry(new Map());
			const page = createMockPage();
			const result = await registry.runIfNeeded(page, "https://example.com", "example.com");
			expect(result).toBe(false);
			expect(page.title).not.toHaveBeenCalled();
		});

		it("returns false when strategy detect returns false", async () => {
			const registry = new SiteWarmupRegistry();
			const page = createMockPage("Reddit Homepage");
			const result = await registry.runIfNeeded(page, "https://reddit.com", "reddit.com");
			expect(result).toBe(false);
			// Title was called (detect ran), but warmup was not triggered
			expect(page.title).toHaveBeenCalled();
			expect(page.goto).toHaveBeenCalledTimes(0);
		});

		it("returns true and runs warmup when detect returns true", async () => {
			const registry = new SiteWarmupRegistry();
			const page = createMockPage("Prove your humanity");
			const result = await registry.runIfNeeded(page, "https://reddit.com", "reddit.com");
			expect(result).toBe(true);
			expect(page.title).toHaveBeenCalled();
			expect(page.goto).toHaveBeenCalledTimes(1);
			expect(page.goto).toHaveBeenCalledWith("https://reddit.com", {
				waitUntil: "domcontentloaded",
				timeout: 15_000,
			});
		});

		it("returns false on detection error (non-fatal)", async () => {
			const registry = new SiteWarmupRegistry();
			const page = {
				title: vi.fn().mockRejectedValue(new Error("page crashed")),
				goto: vi.fn(),
			};
			const result = await registry.runIfNeeded(page, "https://reddit.com", "reddit.com");
			expect(result).toBe(false);
			expect(page.goto).not.toHaveBeenCalled();
		});

		it("returns false on warmup error (non-fatal)", async () => {
			const strategy: WarmupStrategy = {
				name: "failing-warmup",
				detect: () => true,
				warmup: async () => {
					throw new Error("warmup failed");
				},
			};
			const map = new Map([["fail.com", strategy]]);
			const registry = new SiteWarmupRegistry(map);
			const page = createMockPage();
			const result = await registry.runIfNeeded(page, "https://fail.com", "fail.com");
			expect(result).toBe(false);
		});
	});
});

describe("Built-in warmup strategies", () => {
	describe("redditWarmup", () => {
		it("detects 'Prove your humanity' title", async () => {
			const page = createMockPage("Prove your humanity");
			expect(await redditWarmup.detect(page)).toBe(true);
		});

		it("detects title containing 'Prove'", async () => {
			const page = createMockPage("Prove you're not a robot");
			expect(await redditWarmup.detect(page)).toBe(true);
		});

		it("detects title containing 'humanity'", async () => {
			const page = createMockPage("Verify your humanity");
			expect(await redditWarmup.detect(page)).toBe(true);
		});

		it("does not detect normal Reddit title", async () => {
			const page = createMockPage("Reddit - Dive into anything");
			expect(await redditWarmup.detect(page)).toBe(false);
		});

		it("navigates with domcontentloaded on warmup", async () => {
			const page = createMockPage();
			await redditWarmup.warmup(page, "https://reddit.com/r/all");
			expect(page.goto).toHaveBeenCalledWith("https://reddit.com/r/all", {
				waitUntil: "domcontentloaded",
				timeout: 15_000,
			});
		});
	});

	describe("cloudflareWarmup", () => {
		it("detects 'Checking' in title", async () => {
			const page = createMockPage("Checking your browser");
			expect(await cloudflareWarmup.detect(page)).toBe(true);
		});

		it("detects 'Just a moment' in title", async () => {
			const page = createMockPage("Just a moment...");
			expect(await cloudflareWarmup.detect(page)).toBe(true);
		});

		it("detects cf-browser-verification in body", async () => {
			const page = createMockPage("Some title");
			page.evaluate.mockResolvedValue(true);
			expect(await cloudflareWarmup.detect(page)).toBe(true);
		});

		it("does not detect normal page", async () => {
			const page = createMockPage("Welcome");
			page.evaluate.mockResolvedValue(false);
			expect(await cloudflareWarmup.detect(page)).toBe(false);
		});

		it("handles evaluate errors gracefully", async () => {
			const page = createMockPage("Normal Page");
			page.evaluate.mockRejectedValue(new Error("DOM error"));
			expect(await cloudflareWarmup.detect(page)).toBe(false);
		});

		it("navigates with domcontentloaded on warmup", async () => {
			const page = createMockPage();
			// Use vi.useFakeTimers to avoid real 5s wait
			vi.useFakeTimers();
			const warmupPromise = cloudflareWarmup.warmup(page, "https://example.com");
			// Advance past the 5s wait
			await vi.advanceTimersByTimeAsync(6000);
			await warmupPromise;
			vi.useRealTimers();

			expect(page.goto).toHaveBeenCalledWith("https://example.com", {
				waitUntil: "domcontentloaded",
				timeout: 15_000,
			});
		});
	});

	describe("genericVerificationWarmup", () => {
		it("detects 'Attention Required' title", async () => {
			const page = createMockPage("Attention Required");
			expect(await genericVerificationWarmup.detect(page)).toBe(true);
		});

		it("detects 'Access denied' title", async () => {
			const page = createMockPage("Access denied");
			expect(await genericVerificationWarmup.detect(page)).toBe(true);
		});

		it("detects 'Forbidden' title", async () => {
			const page = createMockPage("Forbidden - 403");
			expect(await genericVerificationWarmup.detect(page)).toBe(true);
		});

		it("does not detect normal page", async () => {
			const page = createMockPage("Welcome to my site");
			expect(await genericVerificationWarmup.detect(page)).toBe(false);
		});
	});
});

describe("BUILT_IN_WARMUPS", () => {
	it("contains reddit.com warmup", () => {
		expect(BUILT_IN_WARMUPS.get("reddit.com")).toBe(redditWarmup);
	});

	it("contains cloudflare.com warmup", () => {
		expect(BUILT_IN_WARMUPS.get("cloudflare.com")).toBe(cloudflareWarmup);
	});

	it("contains wildcard fallback", () => {
		expect(BUILT_IN_WARMUPS.get("*")).toBe(cloudflareWarmup);
	});
});
