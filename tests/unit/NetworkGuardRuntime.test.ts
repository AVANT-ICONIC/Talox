import { describe, expect, it, vi } from "vitest";
import { NetworkGuard } from "../../src/core/NetworkGuard.js";

async function getGuardScript(): Promise<string> {
	const scripts: string[] = [];
	const guard = new NetworkGuard({ level: "strict", allowlist: [] });
	await guard.inject({
		async addInitScript(script: string): Promise<void> {
			scripts.push(script);
		},
	});
	return scripts[0]!;
}

function createRuntime() {
	const originalFetch = vi.fn(async () => ({ ok: true }));
	const sendBeacon = vi.fn(() => true);

	class FakeWebSocket {
		static CONNECTING = 0;
		static OPEN = 1;
		static CLOSING = 2;
		static CLOSED = 3;
		constructor(
			public readonly url: string | URL,
			public readonly protocols?: string | string[],
		) {}
	}

	class FakeXMLHttpRequest {
		open(): void {}
		send(): void {}
		abort(): void {}
	}

	const windowObject: Record<string, any> = {
		fetch: originalFetch,
		WebSocket: FakeWebSocket,
	};
	const navigatorObject = { sendBeacon };
	const locationObject = {
		href: "https://app.example.test/page",
		origin: "https://app.example.test",
	};
	const consoleObject = {
		error: vi.fn(),
		warn: vi.fn(),
	};

	const execute = (script: string): void => {
		const run = new Function(
			"window",
			"navigator",
			"WebSocket",
			"XMLHttpRequest",
			"location",
			"URL",
			"console",
			script,
		);
		run(windowObject, navigatorObject, FakeWebSocket, FakeXMLHttpRequest, locationObject, URL, consoleObject);
	};

	return { execute, windowObject, originalFetch, consoleObject };
}

describe("NetworkGuard runtime hardening", () => {
	it("blocks cross-origin URL objects passed directly to fetch", async () => {
		const script = await getGuardScript();
		const runtime = createRuntime();
		runtime.execute(script);

		await expect(runtime.windowObject.fetch(new URL("https://evil.example/collect"))).rejects.toThrow(
			"fetch blocked",
		);
		expect(runtime.originalFetch).not.toHaveBeenCalled();
		expect(runtime.consoleObject.error).toHaveBeenCalledTimes(1);
	});

	it("still allows same-origin URL objects", async () => {
		const script = await getGuardScript();
		const runtime = createRuntime();
		runtime.execute(script);

		await runtime.windowObject.fetch(new URL("https://app.example.test/api"));
		expect(runtime.originalFetch).toHaveBeenCalledTimes(1);
	});

	it("does not wrap fetch again when the init script executes twice", async () => {
		const script = await getGuardScript();
		const runtime = createRuntime();
		runtime.execute(script);
		const firstWrappedFetch = runtime.windowObject.fetch;

		runtime.execute(script);

		expect(runtime.windowObject.fetch).toBe(firstWrappedFetch);
	});
});
