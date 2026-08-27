import { describe, expect, it, vi } from "vitest";
import { PageStateCollector } from "../../src/core/PageStateCollector.js";
import { PerceptionStack } from "../../src/core/PerceptionStack.js";

const secrets = {
	userInfo: "page-url-password",
	queryToken: "page-query-token",
	oauthCode: "page-oauth-code",
	consoleBearer: "console-bearer-secret",
};

function credentialUrl(): string {
	return `https://agent-user:${secrets.userInfo}@example.com/callback?token=${secrets.queryToken}&code=${secrets.oauthCode}&mode=debug`;
}

function makePage() {
	const handlers = new Map<string, (payload: any) => void>();
	const page = {
		url: vi.fn(() => credentialUrl()),
		title: vi.fn(async () => "Credential callback"),
		isClosed: vi.fn(() => false),
		on: vi.fn((event: string, handler: (payload: any) => void) => {
			handlers.set(event, handler);
		}),
		accessibility: {
			snapshot: vi.fn(async () => ({ role: "WebArea", name: "", children: [] })),
		},
		$$: vi.fn(async () => []),
		$$eval: vi.fn(async () => []),
		evaluate: vi.fn(async () => []),
	};
	return { page, handlers };
}

function emitCredentialBearingDiagnostics(handlers: Map<string, (payload: any) => void>): void {
	handlers.get("console")?.({
		type: () => "error",
		text: () => `Authorization: Bearer ${secrets.consoleBearer} callback=${credentialUrl()}`,
	});
	handlers.get("response")?.({
		status: () => 401,
		url: () => credentialUrl(),
		request: () => ({ resourceType: () => "xhr" }),
	});
}

function expectCredentialSafeState(state: unknown): void {
	const serialized = JSON.stringify(state);
	for (const secret of Object.values(secrets)) expect(serialized).not.toContain(secret);
	expect(serialized).toContain("REDACTED");
	expect(serialized).toContain("mode=debug");
}

describe("agent-facing page state credential boundary", () => {
	it("sanitizes current URL, failed request URLs, and console diagnostics", async () => {
		const { page, handlers } = makePage();
		const collector = new PageStateCollector(page as any, {
			useDomFallback: false,
			domFallbackThreshold: 0,
			retry: { maxRetries: 0 },
		});
		emitCredentialBearingDiagnostics(handlers);

		const state = await collector.collect();

		expectCredentialSafeState(state);
		expect(state.url).toContain("mode=debug");
		expect(state.console.errors).toHaveLength(1);
		expect(state.network.failedRequests).toHaveLength(1);
	});

	it("keeps medium perception output credential-safe", async () => {
		const { page, handlers } = makePage();
		const collector = new PageStateCollector(page as any, {
			useDomFallback: false,
			domFallbackThreshold: 0,
			retry: { maxRetries: 0 },
		});
		emitCredentialBearingDiagnostics(handlers);
		const stack = new PerceptionStack(collector, null);

		const state = await stack.collect("medium");

		expectCredentialSafeState(state);
		expect(state.perceptionLayers.network).toBe(true);
	});
});
