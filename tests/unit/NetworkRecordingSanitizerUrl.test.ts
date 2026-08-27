import { describe, expect, it } from "vitest";
import { sanitizeRecordingUrl } from "../../src/core/NetworkRecordingSanitizer.js";

describe("sanitizeRecordingUrl representation stability", () => {
	it("preserves benign URLs byte-for-byte", () => {
		expect(sanitizeRecordingUrl("https://example.com")).toBe("https://example.com");
		expect(sanitizeRecordingUrl("https://example.com/path?mode=debug#section")).toBe(
			"https://example.com/path?mode=debug#section",
		);
	});

	it("still redacts credential-bearing URLs deterministically", () => {
		const raw = "https://user:password-secret@example.com/callback?token=query-secret&code=oauth-secret&mode=debug";
		const sanitized = sanitizeRecordingUrl(raw);

		expect(sanitized).not.toContain("password-secret");
		expect(sanitized).not.toContain("query-secret");
		expect(sanitized).not.toContain("oauth-secret");
		expect(sanitized).toContain("mode=debug");
		expect(sanitizeRecordingUrl(raw)).toBe(sanitized);
	});
});
