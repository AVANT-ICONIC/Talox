import { describe, expect, it, vi } from "vitest";
import { OriginHeaders } from "../../src/core/OriginHeaders.js";

function createPage() {
	return {
		route: vi.fn().mockResolvedValue(undefined),
		unroute: vi.fn().mockResolvedValue(undefined),
	};
}

describe("OriginHeaders session lifecycle", () => {
	it("keeps sibling-page routes installed and is idempotent per page", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const firstPage = createPage();
		const secondPage = createPage();

		await headers.installSessionPage(firstPage as any);
		await headers.installSessionPage(secondPage as any);
		await headers.installSessionPage(firstPage as any);

		expect(firstPage.route).toHaveBeenCalledTimes(1);
		expect(secondPage.route).toHaveBeenCalledTimes(1);
		expect(firstPage.unroute).not.toHaveBeenCalled();
		expect(secondPage.unroute).not.toHaveBeenCalled();

		await headers.dispose();
		expect(firstPage.unroute).toHaveBeenCalledTimes(1);
		expect(secondPage.unroute).toHaveBeenCalledTimes(1);
	});

	it("does not claim ownership when a session route registration fails", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const page = createPage();
		page.route.mockRejectedValue(new Error("route unavailable"));

		await expect(headers.installSessionPage(page as any)).rejects.toThrow("route unavailable");
		await headers.dispose();

		expect(page.unroute).not.toHaveBeenCalled();
	});

	it("disposes every session route best-effort even when one page is already gone", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const closedPage = createPage();
		const livePage = createPage();

		await headers.installSessionPage(closedPage as any);
		await headers.installSessionPage(livePage as any);
		closedPage.unroute.mockRejectedValue(new Error("page closed"));

		await expect(headers.dispose()).resolves.toBeUndefined();
		expect(closedPage.unroute).toHaveBeenCalledTimes(1);
		expect(livePage.unroute).toHaveBeenCalledTimes(1);
	});
});
