import { describe, expect, it, vi } from "vitest";
import { OriginHeaders } from "../../src/core/OriginHeaders.js";

function createPage() {
	let closed = false;
	let closeHandler: (() => void) | null = null;
	return {
		route: vi.fn().mockResolvedValue(undefined),
		unroute: vi.fn().mockResolvedValue(undefined),
		once: vi.fn((event: string, handler: () => void) => {
			if (event === "close") closeHandler = handler;
		}),
		off: vi.fn((event: string, handler: () => void) => {
			if (event === "close" && closeHandler === handler) closeHandler = null;
		}),
		isClosed: vi.fn(() => closed),
		emitClose: () => {
			closed = true;
			const handler = closeHandler;
			closeHandler = null;
			handler?.();
		},
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
		expect(firstPage.once).toHaveBeenCalledTimes(1);
		expect(secondPage.once).toHaveBeenCalledTimes(1);
		expect(firstPage.unroute).not.toHaveBeenCalled();
		expect(secondPage.unroute).not.toHaveBeenCalled();

		await headers.dispose();
		expect(firstPage.unroute).toHaveBeenCalledTimes(1);
		expect(secondPage.unroute).toHaveBeenCalledTimes(1);
		expect(firstPage.off).toHaveBeenCalledTimes(1);
		expect(secondPage.off).toHaveBeenCalledTimes(1);
	});

	it("does not retain ownership or a close listener when route registration fails", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const page = createPage();
		page.route.mockRejectedValue(new Error("route unavailable"));

		await expect(headers.installSessionPage(page as any)).rejects.toThrow("route unavailable");
		expect(page.once).toHaveBeenCalledTimes(1);
		expect(page.off).toHaveBeenCalledTimes(1);
		await headers.dispose();

		expect(page.unroute).not.toHaveBeenCalled();
	});

	it("releases a naturally closed page without touching a surviving sibling", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const closedPage = createPage();
		const livePage = createPage();

		await headers.installSessionPage(closedPage as any);
		await headers.installSessionPage(livePage as any);
		closedPage.emitClose();

		expect(closedPage.unroute).not.toHaveBeenCalled();
		expect(livePage.unroute).not.toHaveBeenCalled();

		await headers.dispose();
		expect(closedPage.unroute).not.toHaveBeenCalled();
		expect(livePage.unroute).toHaveBeenCalledTimes(1);
	});

	it("reconciles a page that closes while route registration is pending", async () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});
		const page = createPage();
		page.route.mockImplementation(async () => {
			page.emitClose();
		});

		await headers.installSessionPage(page as any);
		await headers.dispose();

		expect(page.isClosed).toHaveBeenCalled();
		expect(page.unroute).not.toHaveBeenCalled();
	});

	it("disposes every still-owned session route best-effort when a close event was missed", async () => {
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
