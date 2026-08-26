import { describe, expect, it, vi } from "vitest";
import { OriginHeaders } from "../../src/core/OriginHeaders.js";
import { SessionManager } from "../../src/core/controller/SessionManager.js";
import type { ProfileClass } from "../../src/types/index.js";

function createManager(profileClass: ProfileClass) {
	const manager = new SessionManager({ verbosity: 0 } as any, { emit: vi.fn() } as any, "/tmp/talox-route-chain");
	manager.profile = {
		id: `${profileClass}-route-chain`,
		class: profileClass,
		purpose: "route composition test",
		userDataDir: `/tmp/talox-route-chain/${profileClass}`,
		metadata: { createdAt: "", lastUsed: "" },
	};
	return manager;
}

async function runComposedRequest(profileClass: ProfileClass) {
	const handlers: Array<(route: any) => Promise<void>> = [];
	const page = {
		route: vi.fn(async (_pattern: string, handler: (route: any) => Promise<void>) => {
			handlers.push(handler);
		}),
		unroute: vi.fn().mockResolvedValue(undefined),
		on: vi.fn(),
	};

	const manager = createManager(profileClass);
	await (manager as any).attachSecurityHooks(page);

	const originHeaders = new OriginHeaders({
		"https://api.example.com": { Authorization: "Bearer configured-token-12345678" },
	});
	await originHeaders.install(page as any);

	// Security is registered first and OriginHeaders second. Playwright executes
	// matching routes in reverse registration order, so OriginHeaders must fall
	// back for the security handler to inspect the injected request.
	const state = {
		headers: { accept: "application/json" } as Record<string, string>,
		continued: 0,
		aborted: 0,
	};

	const invoke = async (index: number): Promise<void> => {
		const route = {
			request: () => ({
				method: () => "GET",
				url: () => "https://api.example.com/data",
				headers: () => state.headers,
				postData: () => null,
			}),
			fallback: async (options?: { headers?: Record<string, string> }) => {
				if (options?.headers) state.headers = options.headers;
				if (index > 0) await invoke(index - 1);
				else state.continued++;
			},
			continue: async () => {
				state.continued++;
			},
			abort: async (reason?: string) => {
				expect(reason).toBe("accessdenied");
				state.aborted++;
			},
		};

		await handlers[index]!(route);
	};

	expect(handlers).toHaveLength(profileClass === "sandbox" ? 1 : 2);
	await invoke(handlers.length - 1);
	return state;
}

describe("OriginHeaders security route composition", () => {
	it("lets the ops security handler inspect and block injected credentials", async () => {
		const state = await runComposedRequest("ops");

		expect(state.headers.Authorization).toBe("Bearer configured-token-12345678");
		expect(state.aborted).toBe(1);
		expect(state.continued).toBe(0);
	});

	it("preserves configured OriginHeaders for qa profiles", async () => {
		const state = await runComposedRequest("qa");

		expect(state.headers.Authorization).toBe("Bearer configured-token-12345678");
		expect(state.aborted).toBe(0);
		expect(state.continued).toBe(1);
	});

	it("preserves configured OriginHeaders for sandbox profiles", async () => {
		const state = await runComposedRequest("sandbox");

		expect(state.headers.Authorization).toBe("Bearer configured-token-12345678");
		expect(state.aborted).toBe(0);
		expect(state.continued).toBe(1);
	});
});
