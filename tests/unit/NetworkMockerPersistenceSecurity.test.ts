import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkRecording } from "../../src/core/NetworkMocker.js";
import { NetworkMocker } from "../../src/core/NetworkMocker.js";

const fsMocks = vi.hoisted(() => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => fsMocks);

function makePage() {
	const handlers: Array<(route: any, request: any) => Promise<void>> = [];
	return {
		route: vi.fn(async (_pattern: string | RegExp, handler: (route: any, request: any) => Promise<void>) => {
			handlers.push(handler);
		}),
		unroute: vi.fn(async () => {}),
		_handlers: handlers,
	};
}

function makeRoute() {
	return {
		fallback: vi.fn(async () => {}),
		fulfill: vi.fn(async () => {}),
	};
}

const credentialUrl =
	"https://api-user:url-password-secret@example.com/token/path-token-secret/api?token=query-secret-value&code=oauth-code-secret&mode=full";

function rawRecording(): NetworkRecording {
	return {
		id: "credential-recording",
		url: credentialUrl,
		method: "POST",
		status: 200,
		requestHeaders: {
			authorization: "Bearer request-secret-value",
			cookie: "session=cookie-secret-value",
			"content-type": "application/json",
			"x-custom": "Bearer custom-header-secret-value",
			"x-amz-security-token": "aws-session-secret-value",
		},
		responseHeaders: {
			"content-type": "application/json",
			"content-length": "58",
			"set-cookie": "session=response-cookie-secret-value; HttpOnly",
			"www-authenticate": "Bearer realm=private",
		},
		requestBody: JSON.stringify({
			password: "body-password-secret",
			refresh_token: "refresh-token-secret",
			nested: { api_key: "nested-api-secret" },
			keep: "visible",
		}),
		responseBody: JSON.stringify({ token: "response-token-secret", ok: true }),
		timestamp: 1,
	};
}

describe("NetworkMocker persisted credential safety", () => {
	beforeEach(() => {
		fsMocks.readFile.mockReset();
		fsMocks.writeFile.mockReset();
		fsMocks.writeFile.mockResolvedValue(undefined);
	});

	it("removes credential material from persisted recording JSON by default", async () => {
		const page = makePage();
		const mocker = new NetworkMocker({ context: {} as any, page: page as any });
		fsMocks.readFile.mockResolvedValue(JSON.stringify([rawRecording()]));

		await mocker.loadFromFile("/tmp/raw-recording.json");
		await mocker.saveToFile("/tmp/safe-recording.json");

		expect(fsMocks.writeFile).toHaveBeenCalledOnce();
		const written = fsMocks.writeFile.mock.calls[0]?.[1];
		expect(typeof written).toBe("string");
		const persistedText = String(written);

		for (const secret of [
			"url-password-secret",
			"path-token-secret",
			"query-secret-value",
			"oauth-code-secret",
			"request-secret-value",
			"cookie-secret-value",
			"custom-header-secret-value",
			"aws-session-secret-value",
			"body-password-secret",
			"refresh-token-secret",
			"nested-api-secret",
			"response-token-secret",
			"response-cookie-secret-value",
		]) {
			expect(persistedText).not.toContain(secret);
		}

		const persisted = JSON.parse(persistedText) as NetworkRecording[];
		expect(persisted).toHaveLength(1);
		const recording = persisted[0]!;
		expect(recording.replayUrl).toBe(recording.url);
		expect(recording.url).toContain("mode=full");
		expect(recording.url).toContain("REDACTED");
		expect(recording.requestHeaders.authorization).toBeUndefined();
		expect(recording.requestHeaders.cookie).toBeUndefined();
		expect(recording.requestHeaders["x-amz-security-token"]).toBeUndefined();
		expect(recording.requestHeaders["x-custom"]).toBe("Bearer [REDACTED]");
		expect(recording.responseHeaders["set-cookie"]).toBeUndefined();
		expect(recording.responseHeaders["www-authenticate"]).toBeUndefined();
		expect(recording.responseHeaders["content-length"]).toBeUndefined();
		expect(recording.requestBody).toContain("[REDACTED]");
		expect(recording.requestBody).toContain("visible");
		expect(recording.responseBody).toBe('{"token":"[REDACTED]","ok":true}');
	});

	it("replays a sanitized persisted recording for the original credential-bearing URL", async () => {
		const sourcePage = makePage();
		const sourceMocker = new NetworkMocker({ context: {} as any, page: sourcePage as any });
		fsMocks.readFile.mockResolvedValue(JSON.stringify([rawRecording()]));
		await sourceMocker.loadFromFile("/tmp/raw-recording.json");
		await sourceMocker.saveToFile("/tmp/safe-recording.json");
		const persistedText = String(fsMocks.writeFile.mock.calls[0]?.[1]);

		const replayPage = makePage();
		const replayMocker = new NetworkMocker({ context: {} as any, page: replayPage as any });
		fsMocks.readFile.mockResolvedValue(persistedText);
		await replayMocker.loadFromFile("/tmp/safe-recording.json");
		await replayMocker.startReplaying();

		const route = makeRoute();
		const request = {
			url: vi.fn(() => credentialUrl),
			method: vi.fn(() => "POST"),
		};
		const handler = replayPage._handlers[0]!;
		await handler(route, request);

		expect(route.fulfill).toHaveBeenCalledOnce();
		expect(route.fallback).not.toHaveBeenCalled();
		expect(route.fulfill).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 200,
				body: '{"token":"[REDACTED]","ok":true}',
			}),
		);
	});
});
