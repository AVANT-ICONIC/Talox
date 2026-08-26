import { describe, expect, it, vi } from "vitest";
import { OriginHeaders } from "../../src/core/OriginHeaders.js";

function makePage() {
	return {
		route: vi.fn().mockResolvedValue(undefined),
		unroute: vi.fn().mockResolvedValue(undefined),
		isClosed: vi.fn().mockReturnValue(false),
	} as any;
}

describe("OriginHeaders route lifecycle", () => {
	it("installs only once on the same page", () => {
		const headers = new OriginHeaders();
		const page = makePage();

		headers.install(page);
		headers.install(page);

		expect(page.route).toHaveBeenCalledTimes(1);
	});

	it("rejects installing on another page before disposing the owned route", () => {
		const headers = new OriginHeaders();
		const pageA = makePage();
		const pageB = makePage();
		headers.install(pageA);

		expect(() => headers.install(pageB)).toThrow(/already installed on another page/i);
		expect(pageB.route).not.toHaveBeenCalled();
	});

	it("retains route ownership and config when unroute fails transiently so dispose can retry", async () => {
		const headers = new OriginHeaders({ "https://api.example.com": { Authorization: "Bearer token" } });
		const page = makePage();
		page.unroute.mockRejectedValueOnce(new Error("temporary unroute failure")).mockResolvedValueOnce(undefined);
		headers.install(page);

		await expect(headers.dispose()).rejects.toThrow("temporary unroute failure");
		expect(headers.getHeadersForUrl("https://api.example.com/data")).toEqual({ Authorization: "Bearer token" });

		await expect(headers.dispose()).resolves.toBeUndefined();
		expect(page.unroute).toHaveBeenCalledTimes(2);
		expect(headers.getHeadersForUrl("https://api.example.com/data")).toEqual({});
	});

	it("treats a closed page as already cleaned up", async () => {
		const headers = new OriginHeaders({ "https://api.example.com": { "X-Key": "value" } });
		const page = makePage();
		page.isClosed.mockReturnValue(true);
		page.unroute.mockRejectedValue(new Error("Target page, context or browser has been closed"));
		headers.install(page);

		await expect(headers.dispose()).resolves.toBeUndefined();
		expect(headers.getHeadersForUrl("https://api.example.com")).toEqual({});
	});

	it("releases ownership after asynchronous route registration failure", async () => {
		const headers = new OriginHeaders();
		const pageA = makePage();
		const pageB = makePage();
		pageA.route.mockRejectedValue(new Error("route registration failed"));

		headers.install(pageA);
		await Promise.resolve();
		await Promise.resolve();

		expect(() => headers.install(pageB)).not.toThrow();
		expect(pageB.route).toHaveBeenCalledTimes(1);
	});
});
