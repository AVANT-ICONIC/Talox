import { describe, expect, it } from "vitest";
import { detectCredentialLeak } from "../../src/core/CredentialLeakGuard.js";

describe("detectCredentialLeak", () => {
	it("blocks bearer authorization headers without exposing the value", () => {
		const secret = "Bearer very-secret-access-token";
		const result = detectCredentialLeak({
			method: "GET",
			url: "https://example.com/profile",
			headers: { Authorization: secret },
		});

		expect(result).toEqual({ blocked: true, source: "header", headerName: "authorization" });
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	it("matches API-key header names case-insensitively", () => {
		const result = detectCredentialLeak({
			method: "POST",
			url: "https://example.com/api",
			headers: { "X-API-KEY": "abc12345secret" },
			postData: "{}",
		});

		expect(result).toEqual({ blocked: true, source: "header", headerName: "x-api-key" });
	});

	it("blocks proxy authorization headers", () => {
		const result = detectCredentialLeak({
			method: "GET",
			url: "https://example.com",
			headers: { "Proxy-Authorization": "Basic dXNlcjpwYXNzd29yZA==" },
		});

		expect(result.blocked).toBe(true);
		expect(result.source).toBe("header");
	});

	it("scans PATCH request bodies for credentials", () => {
		const result = detectCredentialLeak({
			method: "PATCH",
			url: "https://example.com/account",
			headers: { "content-type": "application/json" },
			postData: "api_key=abcdefgh12345678",
		});

		expect(result).toEqual({ blocked: true, source: "body" });
	});

	it("scans URLs for credentials regardless of HTTP method", () => {
		const result = detectCredentialLeak({
			method: "GET",
			url: "https://example.com/redirect?token=abcdefgh12345678",
			headers: { accept: "text/html" },
		});

		expect(result).toEqual({ blocked: true, source: "url" });
	});

	it("allows benign requests", () => {
		const result = detectCredentialLeak({
			method: "PATCH",
			url: "https://example.com/profile",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-request-id": "request-12345678",
			},
			postData: JSON.stringify({ displayName: "Talox User" }),
		});

		expect(result).toEqual({ blocked: false });
	});
});
