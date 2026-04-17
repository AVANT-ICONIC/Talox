import { beforeEach, describe, expect, it, vi } from "vitest";
import { OriginHeaders } from "../../src/core/OriginHeaders";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockPage() {
	const handlers: Record<string, Function[]> = {};
	const page = {
		on: vi.fn(),
		off: vi.fn(),
		route: vi.fn().mockImplementation((_pattern: string, handler: Function) => {
			handlers["route"] = handlers["route"] || [];
			handlers["route"].push(handler);
		}),
		unroute: vi.fn().mockResolvedValue(undefined),
		getRouteHandler: () => handlers["route"]?.[0] ?? null,
	};
	return page;
}

function createMockRoute(url: string, headers: Record<string, string>) {
	return {
		request: vi.fn().mockReturnValue({
			url: vi.fn().mockReturnValue(url),
			headers: vi.fn().mockReturnValue(headers),
		}),
		continue: vi.fn().mockResolvedValue(undefined),
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("OriginHeaders", () => {
	describe("constructor", () => {
		it("creates with no config", () => {
			const oh = new OriginHeaders();
			expect(oh.getHeadersForUrl("https://example.com")).toEqual({});
		});

		it("creates with initial config", () => {
			const oh = new OriginHeaders({
				"https://api.example.com": { Authorization: "Bearer token123" },
			});
			const headers = oh.getHeadersForUrl("https://api.example.com/v1/data");
			expect(headers).toEqual({ Authorization: "Bearer token123" });
		});

		it("clones config to prevent external mutation", () => {
			const config = { "https://example.com": { "X-Key": "abc" } };
			const oh = new OriginHeaders(config);
			config["https://example.com"]!.XKey = "mutated";
			expect(oh.getHeadersForUrl("https://example.com")).toEqual({
				"X-Key": "abc",
			});
		});
	});

	describe("setHeaders / removeHeaders", () => {
		it("sets headers for an origin", () => {
			const oh = new OriginHeaders();
			oh.setHeaders("https://example.com", { "X-Custom": "value" });
			expect(oh.getHeadersForUrl("https://example.com/path")).toEqual({
				"X-Custom": "value",
			});
		});

		it("overwrites existing headers for an origin", () => {
			const oh = new OriginHeaders({
				"https://example.com": { "X-Old": "old" },
			});
			oh.setHeaders("https://example.com", { "X-New": "new" });
			expect(oh.getHeadersForUrl("https://example.com")).toEqual({
				"X-New": "new",
			});
		});

		it("removes headers for an origin", () => {
			const oh = new OriginHeaders({
				"https://example.com": { "X-Key": "abc" },
			});
			oh.removeHeaders("https://example.com");
			expect(oh.getHeadersForUrl("https://example.com")).toEqual({});
		});

		it("removeHeaders is a no-op for non-existent origin", () => {
			const oh = new OriginHeaders();
			expect(() => oh.removeHeaders("https://nope.com")).not.toThrow();
		});
	});

	describe("getHeadersForUrl", () => {
		it("matches URL by prefix", () => {
			const oh = new OriginHeaders({
				"https://api.example.com": { Authorization: "Bearer tok" },
			});
			expect(oh.getHeadersForUrl("https://api.example.com/v1/users")).toEqual({
				Authorization: "Bearer tok",
			});
		});

		it("returns empty object for non-matching URL", () => {
			const oh = new OriginHeaders({
				"https://api.example.com": { Authorization: "Bearer tok" },
			});
			expect(oh.getHeadersForUrl("https://other.com/page")).toEqual({});
		});

		it("matches first matching origin", () => {
			const oh = new OriginHeaders({
				"https://api.example.com": { "X-First": "first" },
				"https://api.example.com/v2": { "X-Second": "second" },
			});
			// Depends on insertion order; Map preserves insertion order
			const headers = oh.getHeadersForUrl("https://api.example.com/v2/data");
			expect(headers["X-First"]).toBe("first");
		});

		it("returns a copy (not internal reference)", () => {
			const oh = new OriginHeaders({
				"https://example.com": { "X-Key": "val" },
			});
			const headers = oh.getHeadersForUrl("https://example.com");
			headers["X-Key"] = "mutated";
			expect(oh.getHeadersForUrl("https://example.com")["X-Key"]).toBe("val");
		});
	});

	describe("install / dispose", () => {
		it("installs route handler on page", () => {
			const oh = new OriginHeaders({
				"https://example.com": { "X-Key": "val" },
			});
			const page = createMockPage();
			oh.install(page as any);
			expect(page.route).toHaveBeenCalledWith("**/*", expect.any(Function));
		});

		it("route handler adds headers for matching URLs", async () => {
			const oh = new OriginHeaders({
				"https://example.com": { Authorization: "Bearer tok" },
			});
			const page = createMockPage();
			oh.install(page as any);

			const handler = page.route.mock.calls[0]![1] as Function;
			const route = createMockRoute("https://example.com/api", {
				"content-type": "application/json",
			});

			await handler(route);

			expect(route.request).toHaveBeenCalled();
			expect(route.continue).toHaveBeenCalledWith({
				headers: {
					"content-type": "application/json",
					Authorization: "Bearer tok",
				},
			});
		});

		it("route handler continues without modification for non-matching URLs", async () => {
			const oh = new OriginHeaders({
				"https://api.example.com": { Authorization: "Bearer tok" },
			});
			const page = createMockPage();
			oh.install(page as any);

			const handler = page.route.mock.calls[0]![1] as Function;
			const route = createMockRoute("https://other.com/page", {});

			await handler(route);

			expect(route.continue).toHaveBeenCalledWith();
		});

		it("dispose unroutes and clears config", async () => {
			const oh = new OriginHeaders({
				"https://example.com": { "X-Key": "val" },
			});
			const page = createMockPage();
			oh.install(page as any);
			await oh.dispose();

			expect(page.unroute).toHaveBeenCalledWith("**/*", expect.any(Function));
			expect(oh.getHeadersForUrl("https://example.com")).toEqual({});
		});

		it("dispose handles already-closed page gracefully", async () => {
			const oh = new OriginHeaders({
				"https://example.com": { "X-Key": "val" },
			});
			const page = createMockPage();
			page.unroute.mockRejectedValue(new Error("Page closed"));
			oh.install(page as any);
			await expect(oh.dispose()).resolves.not.toThrow();
		});
	});
});
