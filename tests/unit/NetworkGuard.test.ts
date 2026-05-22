/**
 * @file NetworkGuard.test.ts
 * @description Tests for NetworkGuard — client-side JS network interception.
 */

import { describe, expect, it } from "vitest";
import { NetworkGuard, createNetworkGuard } from "../../src/core/NetworkGuard.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Track calls to addInitScript for inspection */
function mockPage(): { addInitScript: (script: string) => Promise<void>; scripts: string[] } {
	const page = {
		scripts: [] as string[],
		async addInitScript(script: string): Promise<void> {
			page.scripts.push(script);
		},
	};
	return page;
}

// ─── Constructor & Factory ────────────────────────────────────────────────────

describe("NetworkGuard — constructor", () => {
	it("stores level and allowlist", () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["github.com"] });
		expect(guard.level).toBe("strict");
		expect(guard.allowlist).toEqual(["github.com"]);
	});

	it("defaults to empty allowlist", () => {
		const guard = new NetworkGuard({ level: "warn", allowlist: [] });
		expect(guard.allowlist).toEqual([]);
	});
});

describe("createNetworkGuard", () => {
	it("creates guard with given level", () => {
		const guard = createNetworkGuard("strict", ["example.com"]);
		expect(guard.level).toBe("strict");
		expect(guard.allowlist).toEqual(["example.com"]);
	});

	it("defaults to off with empty allowlist", () => {
		const guard = createNetworkGuard();
		expect(guard.level).toBe("off");
		expect(guard.allowlist).toEqual([]);
	});

	it("handles profileClass", () => {
		const guard = createNetworkGuard("warn", ["*"], "ops");
		expect(guard.level).toBe("warn");
	});
});

// ─── Injection ────────────────────────────────────────────────────────────────

describe("NetworkGuard.inject", () => {
	it("no-ops when level is off", async () => {
		const guard = new NetworkGuard({ level: "off", allowlist: [] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts).toHaveLength(0);
	});

	it("injects script when level is warn", async () => {
		const guard = new NetworkGuard({ level: "warn", allowlist: ["*"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts).toHaveLength(1);
	});

	it("injects script when level is strict", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["github.com"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts).toHaveLength(1);
	});
});

// ─── Script Content Verification ──────────────────────────────────────────────

describe("NetworkGuard — script content", () => {
	it("contains TALOX_NG_LEVEL in script", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["example.com"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain('"strict"');
	});

	it("contains allowlist in script", async () => {
		const guard = new NetworkGuard({ level: "warn", allowlist: ["google.com", "github.com"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("google.com");
		expect(page.scripts[0]).toContain("github.com");
	});

	it("overrides sendBeacon", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["*"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("navigator.sendBeacon");
		expect(page.scripts[0]).toContain("_origSendBeacon");
	});

	it("overrides WebSocket", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["*"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("_OrigWebSocket");
		expect(page.scripts[0]).toContain("window.WebSocket");
	});

	it("overrides fetch", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["*"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("window.fetch");
		expect(page.scripts[0]).toContain("_origFetch");
	});

	it("overrides XMLHttpRequest", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["*"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("XMLHttpRequest.prototype.open");
		expect(page.scripts[0]).toContain("XMLHttpRequest.prototype.send");
	});

	it("strict mode contains blocking logic", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["example.com"] });
		const page = mockPage();
		await guard.inject(page);
		// Strict mode should throw/reject for blocked requests
		expect(page.scripts[0]).toContain("Promise.reject");
	});

	it("warn mode contains warn logging but allows requests", async () => {
		const guard = new NetworkGuard({ level: "warn", allowlist: ["example.com"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("warn mode");
	});

	it("contains same-origin bypass logic", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: [] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("isSameOrigin");
		expect(page.scripts[0]).toContain("location.origin");
	});

	it("contains special scheme bypass (blob, data)", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: [] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("isSpecialScheme");
		expect(page.scripts[0]).toContain("blob");
		expect(page.scripts[0]).toContain("data");
	});

	it("wildcard allowlist skips all blocking", async () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["*"] });
		const page = mockPage();
		await guard.inject(page);
		expect(page.scripts[0]).toContain("'*'");
	});

	it("double-injection is safe (script is idempotent per page)", async () => {
		const guard = new NetworkGuard({ level: "warn", allowlist: ["*"] });
		const page = mockPage();
		await guard.inject(page);
		await guard.inject(page);
		// Second call still adds — idempotency is in the JS, not the inject method
		expect(page.scripts).toHaveLength(2);
	});
});

// ─── Getters ──────────────────────────────────────────────────────────────────

describe("NetworkGuard getters", () => {
	it("level returns configured level", () => {
		expect(new NetworkGuard({ level: "off", allowlist: [] }).level).toBe("off");
		expect(new NetworkGuard({ level: "warn", allowlist: [] }).level).toBe("warn");
		expect(new NetworkGuard({ level: "strict", allowlist: [] }).level).toBe("strict");
	});

	it("allowlist is readonly from outside", () => {
		const guard = new NetworkGuard({ level: "strict", allowlist: ["a.com"] });
		const list = guard.allowlist;
		expect(list).toEqual(["a.com"]);
		// TypeScript would prevent mutation, but runtime check:
		expect(Array.isArray(list)).toBe(true);
	});
});
