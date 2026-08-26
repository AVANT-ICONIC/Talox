import { describe, expect, it } from "vitest";
import { OriginHeaders } from "../../src/core/OriginHeaders.js";

describe("OriginHeaders security boundaries", () => {
	it("does not send same-prefix origin headers to a lookalike hostname", () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});

		expect(headers.getHeadersForUrl("https://api.example.com.attacker.test/collect")).toEqual({});
		expect(headers.getHeadersForUrl("https://api.example.com/v1/data")).toEqual({
			Authorization: "Bearer secret",
		});
	});

	it("requires protocol and port to match the configured origin", () => {
		const headers = new OriginHeaders({
			"https://api.example.com": { "X-Api-Key": "secret" },
		});

		expect(headers.getHeadersForUrl("http://api.example.com/v1")).toEqual({});
		expect(headers.getHeadersForUrl("https://api.example.com:8443/v1")).toEqual({});
		expect(headers.getHeadersForUrl("https://api.example.com/v1")).toEqual({ "X-Api-Key": "secret" });
	});

	it("keeps path-scoped rules inside a segment boundary", () => {
		const headers = new OriginHeaders({
			"https://api.example.com/v2": { "X-Version": "2" },
		});

		expect(headers.getHeadersForUrl("https://api.example.com/v2")).toEqual({ "X-Version": "2" });
		expect(headers.getHeadersForUrl("https://api.example.com/v2/users")).toEqual({ "X-Version": "2" });
		expect(headers.getHeadersForUrl("https://api.example.com/v20/users")).toEqual({});
	});

	it("fails closed for malformed request or configured URLs", () => {
		const malformedConfig = new OriginHeaders({
			"not a url": { Authorization: "Bearer secret" },
		});
		const validConfig = new OriginHeaders({
			"https://api.example.com": { Authorization: "Bearer secret" },
		});

		expect(malformedConfig.getHeadersForUrl("https://not-a-url.test")).toEqual({});
		expect(validConfig.getHeadersForUrl("not a request url")).toEqual({});
	});
});
