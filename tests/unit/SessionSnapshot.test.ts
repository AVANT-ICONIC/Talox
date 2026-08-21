import { describe, expect, it, vi } from "vitest";
import { captureSessionSnapshot, restoreSessionSnapshot } from "../../src/core/SessionSnapshot";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePage(
	overrides: Partial<{
		url: () => string;
		title: () => Promise<string>;
		evaluate: (fn: any, ...args: any[]) => Promise<any>;
	}> = {},
) {
	return {
		url: vi.fn().mockReturnValue("https://example.com/dashboard"),
		title: vi.fn().mockResolvedValue("Dashboard"),
		evaluate: vi.fn().mockImplementation(async (fn: ((...args: any[]) => any) | string) => {
			// Default: return empty storage objects
			if (typeof fn === "function") {
				// For scrollX/scrollY queries return { x: 0, y: 100 }
				const src = fn.toString();
				if (src.includes("scrollX")) return { x: 0, y: 100 };
				if (src.includes("localStorage")) return {};
				if (src.includes("sessionStorage")) return {};
			}
			return {};
		}),
		goto: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function makeContext(cookies: any[] = []) {
	return {
		cookies: vi.fn().mockResolvedValue(cookies),
		addCookies: vi.fn().mockResolvedValue(undefined),
	};
}

// ─── captureSessionSnapshot ───────────────────────────────────────────────────

describe("captureSessionSnapshot", () => {
	it("captures url and title", async () => {
		const page = makePage();
		const snap = await captureSessionSnapshot(page, makeContext());
		expect(snap.url).toBe("https://example.com/dashboard");
		expect(snap.title).toBe("Dashboard");
	});

	it("captures cookies from context", async () => {
		const cookies = [
			{
				name: "session",
				value: "abc123",
				domain: "example.com",
				path: "/",
				expires: -1,
				httpOnly: true,
				secure: false,
				sameSite: "Lax",
			},
		];
		const snap = await captureSessionSnapshot(makePage(), makeContext(cookies));
		expect(snap.cookies).toHaveLength(1);
		expect(snap.cookies[0]?.name).toBe("session");
	});

	it("includes capturedAt ISO timestamp", async () => {
		const snap = await captureSessionSnapshot(makePage(), makeContext());
		expect(typeof snap.capturedAt).toBe("string");
		expect(new Date(snap.capturedAt).getFullYear()).toBeGreaterThan(2000);
	});

	it("captures scroll position", async () => {
		const page = makePage({
			evaluate: vi.fn().mockImplementation(async (fn: ((...args: any[]) => any) | string) => {
				const src = fn.toString();
				if (src.includes("scrollX")) return { x: 50, y: 200 };
				return {};
			}),
		});
		const snap = await captureSessionSnapshot(page, makeContext());
		expect(snap.scrollY).toBe(200);
		expect(snap.scrollX).toBe(50);
	});

	it("returns empty localStorage for non-http URL", async () => {
		const page = makePage({ url: vi.fn().mockReturnValue("chrome://newtab/") });
		const snap = await captureSessionSnapshot(page, makeContext());
		expect(snap.localStorage).toEqual({});
	});

	it("handles cookie extraction failure gracefully", async () => {
		const context = { cookies: vi.fn().mockRejectedValue(new Error("blocked")) };
		const snap = await captureSessionSnapshot(makePage(), context);
		expect(snap.cookies).toEqual([]);
	});
});

// ─── restoreSessionSnapshot ───────────────────────────────────────────────────

describe("restoreSessionSnapshot", () => {
	const baseSnap = {
		url: "https://example.com/dashboard",
		title: "Dashboard",
		capturedAt: new Date().toISOString(),
		cookies: [
			{
				name: "sid",
				value: "xyz",
				domain: "example.com",
				path: "/",
				expires: -1,
				httpOnly: false,
				secure: false,
				sameSite: "None" as const,
			},
		],
		localStorage: { theme: "dark" },
		sessionStorage: { draft: "hello" },
		scrollX: 0,
		scrollY: 300,
	};

	it("adds cookies before navigation", async () => {
		const context = makeContext();
		const page = { ...makePage(), evaluate: vi.fn().mockResolvedValue(undefined) };
		await restoreSessionSnapshot(page, context, baseSnap);
		expect(context.addCookies).toHaveBeenCalledWith(baseSnap.cookies);
	});

	it("navigates to captured URL", async () => {
		const context = makeContext();
		const page = { ...makePage(), evaluate: vi.fn().mockResolvedValue(undefined) };
		await restoreSessionSnapshot(page, context, baseSnap);
		expect(page.goto).toHaveBeenCalledWith(baseSnap.url, expect.any(Object));
	});

	it("restores scroll position", async () => {
		const context = makeContext();
		let scrollCalled = false;
		const page = {
			...makePage(),
			evaluate: vi.fn().mockImplementation(async (fn: any, args: any) => {
				if (Array.isArray(args) && args.includes(300)) scrollCalled = true;
				return undefined;
			}),
		};
		await restoreSessionSnapshot(page, context, baseSnap);
		expect(scrollCalled).toBe(true);
	});

	it("skips cookies when snapshot has none", async () => {
		const snap = { ...baseSnap, cookies: [] };
		const context = makeContext();
		const page = { ...makePage(), evaluate: vi.fn().mockResolvedValue(undefined) };
		await restoreSessionSnapshot(page, context, snap);
		expect(context.addCookies).not.toHaveBeenCalled();
	});

	it("does not throw when navigation fails", async () => {
		const context = makeContext();
		const page = {
			...makePage(),
			goto: vi.fn().mockRejectedValue(new Error("net::ERR_CONNECTION_REFUSED")),
			evaluate: vi.fn().mockResolvedValue(undefined),
		};
		await expect(restoreSessionSnapshot(page, context, baseSnap)).resolves.toBeUndefined();
	});
});
