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
	const newCDPSession = vi.fn().mockResolvedValue(cdpSession);
	return {
		on: vi.fn(),
		context: vi.fn().mockReturnValue({ newCDPSession }),
		newCDPSession,
	};
}

async function attach(
	manager: CrossOriginManager,
	frameUrl: string,
	parentUrl = "https://app.example.com/page",
	frameName = "child",
	cdpSession = createMockCDPSession(),
) {
	const page = createMockPage(cdpSession);
	manager.install(page as any);
	const parent = createMockFrame({ name: "parent", url: parentUrl, parent: null });
	const child = createMockFrame({ name: frameName, url: frameUrl, parent });
	const handler = page.on.mock.calls.find((call: any[]) => call[0] === "frameattached")?.[1];
	await handler!(child);
	return { page, child, parent, cdpSession };
}

describe("CrossOriginManager trust detection", () => {
	beforeEach(() => vi.clearAllMocks());

	it("default-denies unrelated cross-origin frames", () => {
		const manager = new CrossOriginManager();
		expect(manager.assessTrust("https://payments.example.net/embed", "https://shop.example.com")).toEqual({
			level: "external",
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

	it("recognizes exact same-origin URLs as first-party", () => {
		const manager = new CrossOriginManager();
		const result = manager.assessTrust("https://app.example.com/embed", "https://app.example.com/page");
		expect(result.trusted).toBe(true);
		expect(result.level).toBe("first-party");
		expect(result.reason).toBe("same-origin");
	});

	it("uses trustedDomains as the canonical explicit allowlist", () => {
		const manager = new CrossOriginManager({
			trustedDomains: ["payments.example.net/sdk/path?ignored=true"],
		});
		const allowed = manager.assessTrust("https://payments.example.net/embed", "https://shop.example.com");
		const portChanged = manager.assessTrust("https://payments.example.net:8443/embed", "https://shop.example.com");
		expect(allowed.trusted).toBe(true);
		expect(allowed.level).toBe("first-party");
		expect(allowed.reason).toBe("explicit-trusted-origin");
		expect(portChanged.trusted).toBe(false);
	});

	it("keeps trustedOrigins as a compatibility alias", () => {
		const manager = new CrossOriginManager({ trustedOrigins: ["https://legacy.example.net"] });
		expect(manager.assessTrust("https://legacy.example.net/embed", "https://shop.example.com").trusted).toBe(true);
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

	it("rejects invalid, opaque, and wildcard trustedDomains entries", () => {
		expect(() => new CrossOriginManager({ trustedDomains: ["not a URL / broken"] })).toThrow(
			"Invalid trusted iframe domain/origin",
		);
		expect(() => new CrossOriginManager({ trustedDomains: ["data:text/plain,nope"] })).toThrow(
			"Opaque origins cannot be trusted",
		);
		expect(() => new CrossOriginManager({ trustedDomains: ["*.example.net"] })).toThrow(
			"Wildcard trusted domains are not supported",
		);
	});

	it("persists trust metadata on tracked cross-origin sessions", async () => {
		const manager = new CrossOriginManager({ trustedDomains: ["payments.example.net"] });
		await attach(manager, "https://payments.example.net/embed");
		const session = manager.getSession("child");
		expect(session?.trust).toMatchObject({
			level: "first-party",
			trusted: true,
			reason: "explicit-trusted-origin",
		});
		expect(manager.getTrust("child")).toEqual(session?.trust);
		expect(manager.isTrusted("child")).toBe(true);
	});

	it("creates the CDP session for the target frame, not the page", async () => {
		const manager = new CrossOriginManager({ trustedDomains: ["trusted.example.net"] });
		const { page, child } = await attach(manager, "https://trusted.example.net/embed");
		expect(page.newCDPSession).toHaveBeenCalledWith(child);
	});

	it("splits tracked sessions into trusted and untrusted inspection lists", async () => {
		const manager = new CrossOriginManager({ trustedDomains: ["trusted.example.net"] });
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
		const cdp = createMockCDPSession();
		const manager = new CrossOriginManager();
		await attach(manager, "https://unknown.example.org/embed", undefined, undefined, cdp);

		await expect(manager.executeInTrustedFrame("child", "Runtime.evaluate", { expression: "1+1" })).rejects.toThrow(
			"Refusing trusted-frame execution",
		);
		expect(cdp.send).not.toHaveBeenCalled();
	});

	it("allows trusted-frame execution for an exact allowlisted origin", async () => {
		const cdp = createMockCDPSession();
		const manager = new CrossOriginManager({ trustedDomains: ["trusted.example.net"] });
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

	it("keeps an unnamed frame ID stable and invalidates stale trust after navigation", async () => {
		const firstCdp = createMockCDPSession();
		const secondCdp = createMockCDPSession();
		const newCDPSession = vi.fn().mockResolvedValueOnce(firstCdp).mockResolvedValueOnce(secondCdp);
		const page = createMockPage();
		page.context.mockReturnValue({ newCDPSession });
		const manager = new CrossOriginManager({ trustedDomains: ["trusted.example.net"] });
		manager.install(page as any);

		const parent = createMockFrame({ name: "parent", url: "https://app.example.com", parent: null });
		const child = createMockFrame({ name: "", url: "https://trusted.example.net/embed", parent });
		const attachHandler = page.on.mock.calls.find((call: any[]) => call[0] === "frameattached")?.[1];
		const navigateHandler = page.on.mock.calls.find((call: any[]) => call[0] === "framenavigated")?.[1];

		await attachHandler!(child);
		const original = manager.getAllSessions()[0]!;
		expect(original.trust.trusted).toBe(true);
		const stableId = original.frameId;

		child.url.mockReturnValue("https://evil.example.org/embed");
		await navigateHandler!(child);

		expect(firstCdp.detach).toHaveBeenCalled();
		expect(manager.getAllSessions()).toHaveLength(1);
		const current = manager.getAllSessions()[0]!;
		expect(current.frameId).toBe(stableId);
		expect(current.trust).toMatchObject({ level: "external", trusted: false });
		await expect(manager.executeInTrustedFrame(stableId, "Runtime.evaluate")).rejects.toThrow(
			"Refusing trusted-frame execution",
		);
	});
});
