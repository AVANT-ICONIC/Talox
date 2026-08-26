import { describe, expect, it, vi } from "vitest";
import { OriginHeaders } from "../../src/core/OriginHeaders.js";

function createPage() {
	return {
		route: vi.fn().mockResolvedValue(undefined),
		unroute: vi.fn().mockResolvedValue(undefined),
	};
}

describe("OriginHeaders install lifecycle", () => {
	it("waits for Playwright route registration before resolving install", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const page = createPage();
		let releaseRegistration!: () => void;
		const registration = new Promise<void>((resolve) => {
			releaseRegistration = resolve;
		});
		page.route.mockReturnValue(registration);

		let settled = false;
		const installing = headers.install(page as any).then(() => {
			settled = true;
		});

		await Promise.resolve();
		expect(settled).toBe(false);

		releaseRegistration();
		await installing;
		expect(settled).toBe(true);
		await headers.dispose();
	});

	it("rejects a failed route installation without claiming ownership", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const page = createPage();
		const failure = new Error("route install failed");
		page.route.mockRejectedValue(failure);

		await expect(headers.install(page as any)).rejects.toBe(failure);
		await headers.dispose();

		expect(page.unroute).not.toHaveBeenCalled();
	});

	it("does not install duplicate handlers on the same page", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const page = createPage();

		await headers.install(page as any);
		await headers.install(page as any);

		expect(page.route).toHaveBeenCalledTimes(1);
		await headers.dispose();
		expect(page.unroute).toHaveBeenCalledTimes(1);
	});

	it("keeps the current page installed when replacement route acquisition fails", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const currentPage = createPage();
		const replacementPage = createPage();
		replacementPage.route.mockRejectedValue(new Error("replacement unavailable"));

		await headers.install(currentPage as any);
		await expect(headers.install(replacementPage as any)).rejects.toThrow("replacement unavailable");
		await headers.dispose();

		expect(currentPage.unroute).toHaveBeenCalledTimes(1);
		expect(replacementPage.unroute).not.toHaveBeenCalled();
	});

	it("rolls back the replacement route if old-page cleanup fails", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const currentPage = createPage();
		const replacementPage = createPage();
		currentPage.unroute.mockRejectedValueOnce(new Error("old route cleanup failed")).mockResolvedValue(undefined);

		await headers.install(currentPage as any);
		await expect(headers.install(replacementPage as any)).rejects.toThrow("old route cleanup failed");

		expect(replacementPage.unroute).toHaveBeenCalledTimes(1);

		await headers.dispose();
		expect(currentPage.unroute).toHaveBeenCalledTimes(2);
	});
});
