import { beforeEach, describe, expect, it, vi } from "vitest";
import { CrossOriginManager } from "../../src/core/CrossOriginManager.js";

function createMockCDPSession() {
	return {
		send: vi.fn().mockResolvedValue({ result: { value: 42 } }),
		detach: vi.fn().mockResolvedValue(undefined),
		on: vi.fn(),
		off: vi.fn(),
	};
}

function createMockFrame(overrides: { name?: string; url: string; parent?: ReturnType<typeof createMockFrame> | null }) {
	return {
		name: vi.fn().mockReturnValue(overrides.name ?? ""),
		url: vi.fn().mockReturnValue(overrides.url),
		parentFrame: vi.fn().mockReturnValue(overrides.parent ?? null),
	};
}

function createMockPage(cdpSession = createMockCDPSession()) {
	return {
		on: vi.fn(),
		context: vi.fn().mockReturnValue({ newCDPSession: vi.fn().mockResolvedValue(cdpSession) }),
	};
}

async function attach(
	manager: CrossOriginManager,
	frameUrl: string,
	parentUrl = "https://app.example.com/page",
	frameName = "child",
) {
	const page = createMockPage();
	manager.install(page as any);
	const parent = createMockFrame({ name: "parent", url: parentUrl, parent: null });
	const child = createMockFrame({ name: frameName, url: frameUrl, parent });
	const handler = page.on.mock.calls.find((call: any[]) => call[0] === "frameattached")?.[1];
	await handler!(child);
	return { page, child };
}

describe("CrossOriginManager trust detection", () => {
	beforeEach(() => vi.clearAllMocks());

	it("default-denies unrelated cross-origin frames", () => {
		const manager = new CrossOriginManager();
		expect(manager.assessTrust("https://payments.example.net/embed", "https://shop.example.com")).toEqual({
			level: "untrusted",
			trusted: false,
			reason: "cross-origin-default-deny",
			origin: "https://payments.example.net",
			parentOrigin: "https://shop.example.com",
		});
	});

	it("does not implicitly trust sibling or child subdomains", () => {
		const manager = new CrossOriginManager();
		expect(manager.assessTrust("https://cdn.example.com/embed", "https://app.example.com").trusted).toBe(false);
		expect(manager.assessTrust("https://evil.app.example.com/embed", "https://app.example.com").trusted).toBe(false);
	});

	it("recognizes exact same-origin URLs as trusted", () => {
		const manager = new CrossOriginManager();
		const result = manager.assessTrust("https://app.example.com/embed", "https://app.example.com/page");
		expect(result.trusted).toBe(true);
		expect(result.reason).toBe("same-origin");
	});

	it("trusts only explicitly allowlisted cross-origin origins", () => {
		const manager = new CrossOriginManager({
			trustedOrigins: ["https://payments.example.net/sdk/path?ignored=true"],
		});
		const allowed = manager.assessTrust("https://payments.example.net/embed", "https://shop.example.com");
		const portChanged = manager.assessTrust("https://payments.example.net:8443/embed", "https://shop.example.com");
		expect(allowed.trusted).toBe(true);
		expect(allowed.reason).toBe("explicit-trusted-origin");
		expect(portChanged.trusted).toBe(false);
	});

	it("classifies opaque and invalid URLs without accidentally trusting them", () => {
		const manager = new CrossOriginManager();
		expect(manager.assessTrust("data:text/html,hello", "https://app.example.com")).toMatchObject({
			level: "opaque",
			trusted: false,
			reason: "opaque-origin",
		});
		expect(manager.assessTrust("not a URL", "https://app.example.com")).toMatchObject({
			level: "opaque",
			trusted: false,
			reason: "invalid-url",
		});
	});

	it("rejects invalid and opaque allowlist entries", () => {
		expect(() => new CrossOriginManager({ trustedOrigins: ["not a URL"] })).toThrow("Invalid trusted iframe origin");
		expect(() => new CrossOriginManager({ trustedOrigins: ["data:text/plain,nope"] })).toThrow(
			"Opaque origins cannot be trusted",
		);
	});

	it("persists trust metadata on tracked cross-origin sessions", async () => {
		const manager = new CrossOriginManager({ trustedOrigins: ["https://payments.example.net"] });
		await attach(manager, "https://payments.example.net/embed");
		const session = manager.getSession("child");
		expect(session?.trust).toMatchObject({
			level: "trusted",
			trusted: true,
			reason: "explicit-trusted-origin",
		});
		expect(manager.getTrust("child")).toEqual(session?.trust);
		expect(manager.isTrusted("child")).toBe(true);
	});

	it("splits tracked sessions into trusted and untrusted inspection lists", async () => {
		const manager = new CrossOriginManager({ trustedOrigins: ["https://trusted.example.net"] });
		const page = createMockPage();
		manager.install(page as any);
		const parent = createMockFrame({ name: "parent", url: "https://app.example.com", parent: null });
		const trusted = createMockFrame({ name: "trusted", url: "https://trusted.example.net/embed", parent });
		const untrusted = createMockFrame({ name: "untrusted", url: "https://unknown.example.org/embed", parent });
		const handler = page.on.mock.calls.find((call: any[]) => call[0] === "frameattached")?.[1];
		await handler!(trusted);
		await handler!(untrusted);

		expect(manager.getTrustedSessions().map((session) => session.frameId)).toEqual(["trusted"]);
		expect(manager.getUntrustedSessions().map((session) => session.frameId)).toEqual(["untrusted"]);
	});

	it("blocks trusted-frame execution for default-denied origins", async () => {
		const manager = new CrossOriginManager();
		const { page } = await attach(manager, "https://unknown.example.org/embed");
		const cdp = await page.context().newCDPSession();

		await expect(manager.executeInTrustedFrame("child", "Runtime.evaluate", { expression: "1+1" })).rejects.toThrow(
			"Refusing trusted-frame execution",
		);
		expect(cdp.send).not.toHaveBeenCalled();
	});

	it("allows trusted-frame execution for an exact allowlisted origin", async () => {
		const cdp = createMockCDPSession();
		const manager = new CrossOriginManager({ trustedOrigins: ["https://trusted.example.net"] });
		const page = createMockPage(cdp);
		manager.install(page as any);
		const parent = createMockFrame({ name: "parent", url: "https://app.example.com", parent: null });
		const child = createMockFrame({ name: "trusted-child", url: "https://trusted.example.net/embed", parent });
		const handler = page.on.mock.calls.find((call: any[]) => call[0] === "frameattached")?.[1];
		await handler!(child);

		await expect(
			manager.executeInTrustedFrame("trusted-child", "Runtime.evaluate", { expression: "1+1" }),
		).resolves.toEqual({ result: { value: 42 } });
		expect(cdp.send).toHaveBeenCalledWith("Runtime.evaluate", { expression: "1+1" });
	});
});
