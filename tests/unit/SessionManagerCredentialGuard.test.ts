import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/controller/SessionManager.js";

function createManager() {
	const manager = new SessionManager({ verbosity: 0 } as any, { emit: vi.fn() } as any, "/tmp/talox-credential-guard");
	manager.profile = {
		id: "ops-test",
		class: "ops",
		purpose: "credential guard test",
		userDataDir: "/tmp/talox-credential-guard/profile",
		metadata: { createdAt: "", lastUsed: "" },
	};
	return manager;
}

async function installRouteHandler(manager: SessionManager) {
	let handler: ((route: any) => Promise<void>) | undefined;
	const page = {
		route: vi.fn(async (_pattern: string, routeHandler: (route: any) => Promise<void>) => {
			handler = routeHandler;
		}),
		on: vi.fn(),
	};

	await (manager as any).attachSecurityHooks(page);
	expect(page.route).toHaveBeenCalledWith("**/*", expect.any(Function));
	if (!handler) throw new Error("Security route handler was not installed");
	return handler;
}

function createRoute(overrides: {
	method?: string;
	url?: string;
	headers?: Record<string, string>;
	postData?: string | null;
} = {}) {
	const request = {
		method: vi.fn(() => overrides.method ?? "GET"),
		url: vi.fn(() => overrides.url ?? "https://example.com/health"),
		headers: vi.fn(() => overrides.headers ?? { accept: "application/json" }),
		postData: vi.fn(() => overrides.postData ?? null),
	};
	return {
		request: vi.fn(() => request),
		abort: vi.fn().mockResolvedValue(undefined),
		continue: vi.fn().mockResolvedValue(undefined),
	};
}

describe("SessionManager credential protocol guard", () => {
	it("aborts credential-bearing authorization headers", async () => {
		const handler = await installRouteHandler(createManager());
		const route = createRoute({ headers: { Authorization: "Bearer abcdefgh12345678" } });

		await handler(route);

		expect(route.abort).toHaveBeenCalledWith("accessdenied");
		expect(route.continue).not.toHaveBeenCalled();
	});

	it("continues benign requests", async () => {
		const handler = await installRouteHandler(createManager());
		const route = createRoute({
			method: "PATCH",
			url: "https://example.com/profile",
			headers: { "content-type": "application/json", "x-request-id": "request-12345678" },
			postData: JSON.stringify({ displayName: "Talox User" }),
		});

		await handler(route);

		expect(route.continue).toHaveBeenCalledTimes(1);
		expect(route.abort).not.toHaveBeenCalled();
	});
});
