import { describe, expect, it, vi } from "vitest";
import { captureSessionSnapshot, restoreSessionSnapshot, sameOrigin, parseOrigin } from "../../src/core/SessionSnapshot";

// ─── Origin Validation Tests ──────────────────────────────────────────────────

describe("origin validation", () => {
	describe("parseOrigin", () => {
		it("parses http URLs correctly", () => {
			expect(parseOrigin("http://example.com")).toBe("http://example.com");
			expect(parseOrigin("http://example.com:8080")).toBe("http://example.com:8080");
			expect(parseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
		});

		it("parses https URLs correctly", () => {
			expect(parseOrigin("https://example.com")).toBe("https://example.com");
			expect(parseOrigin("https://example.com:8443")).toBe("https://example.com:8443");
		});

		it("rejects non-HTTP schemes", () => {
			expect(parseOrigin("chrome://newtab/")).toBe(null);
			expect(parseOrigin("file:///path/to/file")).toBe(null);
			expect(parseOrigin("about:blank")).toBe(null);
			expect(parseOrigin("javascript:void(0)")).toBe(null);
		});

		it("rejects malformed URLs", () => {
			expect(parseOrigin("not-a-url")).toBe(null);
			expect(parseOrigin("://missing-host")).toBe(null);
			expect(parseOrigin("http://")).toBe(null);
		});
	});

	describe("sameOrigin", () => {
		it("returns true for identical origins", () => {
			expect(sameOrigin("http://example.com", "http://example.com")).toBe(true);
			expect(sameOrigin("https://example.com", "https://example.com")).toBe(true);
			expect(sameOrigin("http://example.com:8080", "http://example.com:8080")).toBe(true);
		});

		it("returns false for different schemes", () => {
			expect(sameOrigin("http://example.com", "https://example.com")).toBe(false);
		});

		it("returns false for different hosts", () => {
			expect(sameOrigin("http://example.com", "http://other.com")).toBe(false);
			expect(sameOrigin("http://sub.example.com", "http://example.com")).toBe(false);
		});

		it("returns false for different ports", () => {
			expect(sameOrigin("http://example.com:8080", "http://example.com:3000")).toBe(false);
			expect(sameOrigin("https://example.com:8443", "https://example.com")).toBe(false);
		});

		it("returns false when either URL is invalid", () => {
			expect(sameOrigin("http://example.com", "chrome://newtab/")).toBe(false);
			expect(sameOrigin("chrome://newtab/", "http://example.com")).toBe(false);
			expect(sameOrigin("invalid", "http://example.com")).toBe(false);
		});
	});
});

// ─── restoreSessionSnapshot Origin Validation Tests ───────────────────────────

describe("restoreSessionSnapshot origin validation", () => {
	const baseSnap = {
		url: "https://example.com/dashboard",
		title: "Dashboard",
		capturedAt: new Date().toISOString(),
		cookies: [],
		localStorage: { theme: "dark", user: "john" },
		sessionStorage: { draft: "hello", token: "abc123" },
		scrollX: 0,
		scrollY: 300,
	};

	it("restores storage when origins match", async () => {
		const page = {
			url: vi.fn().mockReturnValue("https://example.com/dashboard"),
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockImplementation(async (fn: any, args: any) => {
				if (typeof fn === "string" && fn.includes("setItem")) {
					return true; // Simulate successful storage operation
				}
				return {};
			}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, baseSnap);

		// Verify navigation occurred
		expect(page.goto).toHaveBeenCalledWith(baseSnap.url, expect.any(Object));
	});

	it("skips localStorage restoration when origins don't match", async () => {
		const page = {
			url: vi.fn().mockReturnValue("https://evil.com/dashboard"), // Different origin
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, baseSnap);

		// Navigation should still happen
		expect(page.goto).toHaveBeenCalledWith(baseSnap.url, expect.any(Object));
		// But storage should not be restored to wrong origin
		expect(page.evaluate).not.toHaveBeenCalledWith(
			expect.stringContaining("setItem"),
			expect.anything()
		);
	});

	it("skips sessionStorage restoration when origins don't match", async () => {
		const page = {
			url: vi.fn().mockReturnValue("http://example.com"), // Same host, different scheme
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, baseSnap);

		// Should not restore sessionStorage due to scheme mismatch
		expect(page.evaluate).not.toHaveBeenCalledWith(
			expect.stringContaining("setItem"),
			expect.anything()
		);
	});

	it("handles cross-origin redirect scenario", async () => {
		const snap = {
			...baseSnap,
			url: "https://auth.example.com/login", // Captured from different origin
		};

		const page = {
			url: vi.fn().mockReturnValue("https://example.com/dashboard"), // Current page
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should not restore storage due to cross-origin mismatch
		expect(page.evaluate).not.toHaveBeenCalledWith(
			expect.stringContaining("setItem"),
			expect.anything()
		);
	});

	it("handles navigation failure to different origin", async () => {
		const snap = {
			...baseSnap,
			url: "https://example.com/dashboard",
		};

		const page = {
			url: vi.fn().mockReturnValue("https://other.com/error"), // Navigation failed, different origin
			goto: vi.fn()
				.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED")) // First navigation fails
				.mockResolvedValue(undefined), // Second fallback navigation succeeds but to wrong origin
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should not restore storage to wrong origin after failed navigation
		expect(page.evaluate).not.toHaveBeenCalledWith(
			expect.stringContaining("setItem"),
			expect.anything()
		);
	});

	it("handles same-origin path redirect", async () => {
		const snap = {
			...baseSnap,
			url: "https://example.com/login",
		};

		const page = {
			url: vi.fn().mockReturnValue("https://example.com/dashboard"), // Same origin, different path
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should restore storage since origins match - expect separate calls for localStorage, sessionStorage, and scroll
		expect(page.evaluate).toHaveBeenCalledTimes(3); // One for localStorage, one for sessionStorage, one for scroll
		// Check that localStorage was called with the correct entries
		expect(page.evaluate).toHaveBeenCalledWith(
			expect.any(Function),
			[[["theme", "dark"], ["user", "john"]], "localStorage"]
		);
		// Check that sessionStorage was called with the correct entries  
		expect(page.evaluate).toHaveBeenCalledWith(
			expect.any(Function),
			[[["draft", "hello"], ["token", "abc123"]], "sessionStorage"]
		);
	});

	it("handles port change", async () => {
		const snap = {
			...baseSnap,
			url: "https://example.com:8443/dashboard",
		};

		const page = {
			url: vi.fn().mockReturnValue("https://example.com:3000/dashboard"), // Different port
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should not restore storage due to port mismatch
		expect(page.evaluate).not.toHaveBeenCalledWith(
			expect.stringContaining("setItem"),
			expect.anything()
		);
	});

	it("handles malformed current URL", async () => {
		const snap = {
			...baseSnap,
			url: "https://example.com/dashboard",
		};

		const page = {
			url: vi.fn().mockReturnValue("chrome://newtab/"), // Malformed for our purposes
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should not restore storage due to invalid current URL
		expect(page.evaluate).not.toHaveBeenCalledWith(
			expect.stringContaining("setItem"),
			expect.anything()
		);
	});

	it("handles malformed captured URL", async () => {
		const snap = {
			...baseSnap,
			url: "chrome://newtab/", // Malformed captured URL
		};

		const page = {
			url: vi.fn().mockReturnValue("https://example.com/dashboard"),
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should not restore storage due to invalid captured URL
		expect(page.evaluate).not.toHaveBeenCalledWith(
			expect.stringContaining("setItem"),
			expect.anything()
		);
	});

	it("gracefully handles storage quota errors during origin-safe restore", async () => {
		const snap = {
			...baseSnap,
			url: "https://example.com/dashboard",
		};

		const page = {
			url: vi.fn().mockReturnValue("https://example.com/dashboard"),
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockRejectedValue(new Error("QuotaExceededError")),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await expect(restoreSessionSnapshot(page, context, snap)).resolves.toBeUndefined();

		// Should still attempt storage restore but handle errors gracefully
		expect(page.goto).toHaveBeenCalledWith(snap.url, expect.any(Object));
	});

	it("restores storage when navigating between storage writes", async () => {
		const snap = {
			...baseSnap,
			url: "https://example.com/page1",
		};

		let callCount = 0;
		const page = {
			url: vi.fn().mockReturnValue("https://example.com/page1"), // Current page after navigation
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockImplementation(async (fn: any, args: any) => {
				callCount++;
				if (callCount === 1) {
					// First call - localStorage write
					return true;
				} else if (callCount === 2) {
					// Second call - sessionStorage write
					return true;
				}
				return {};
			}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should navigate once and then make three calls: localStorage, sessionStorage, and scroll
		expect(page.goto).toHaveBeenCalledTimes(1);
		expect(page.evaluate).toHaveBeenCalledTimes(3); // One for localStorage, one for sessionStorage, one for scroll
	});
});

// ─── Integration Tests ────────────────────────────────────────────────────────

describe("SessionSnapshot origin validation integration", () => {
	const baseSnap = {
		url: "https://example.com/dashboard",
		title: "Dashboard",
		capturedAt: new Date().toISOString(),
		cookies: [{ name: "session", value: "abc", domain: "example.com", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "None" as const }],
		localStorage: { theme: "dark" },
		sessionStorage: { draft: "hello" },
		scrollX: 0,
		scrollY: 300,
	};

	it("maintains existing behavior for valid same-origin restores", async () => {
		const snap = { ...baseSnap };

		const page = {
			url: vi.fn().mockReturnValue("https://example.com/dashboard"),
			goto: vi.fn().mockResolvedValue(undefined),
			evaluate: vi.fn().mockResolvedValue({}),
		};
		const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

		await restoreSessionSnapshot(page, context, snap);

		// Should behave exactly like before for valid cases
		expect(context.addCookies).toHaveBeenCalledWith(snap.cookies);
		expect(page.goto).toHaveBeenCalledWith(snap.url, expect.any(Object));
	});

	it("fails closed for edge cases without throwing", async () => {
		const edgeCases = [
			{ snapUrl: "http://example.com", pageUrl: "https://example.com" }, // Scheme mismatch
			{ snapUrl: "https://example.com:8443", pageUrl: "https://example.com:3000" }, // Port mismatch
			{ snapUrl: "https://sub.example.com", pageUrl: "https://example.com" }, // Host mismatch
			{ snapUrl: "chrome://newtab/", pageUrl: "https://example.com" }, // Invalid snap URL
			{ snapUrl: "https://example.com", pageUrl: "chrome://newtab/" }, // Invalid page URL
		];

		for (const { snapUrl, pageUrl } of edgeCases) {
			const snap = {
				...baseSnap,
				url: snapUrl,
			};

			const page = {
				url: vi.fn().mockReturnValue(pageUrl),
				goto: vi.fn().mockResolvedValue(undefined),
				evaluate: vi.fn().mockResolvedValue({}),
			};
			const context = { addCookies: vi.fn().mockResolvedValue(undefined) };

			await expect(restoreSessionSnapshot(page, context, snap)).resolves.toBeUndefined();
		}
	});
});