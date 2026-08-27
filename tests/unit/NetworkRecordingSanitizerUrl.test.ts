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

	it("redacts common cloud signed-URL credentials", () => {
		const cases = [
			{
				url: "https://s3.example.com/file?X-Amz-Signature=aws-signature-secret&X-Amz-Credential=aws-credential-secret&X-Amz-Security-Token=aws-session-secret&mode=download",
				secrets: ["aws-signature-secret", "aws-credential-secret", "aws-session-secret"],
			},
			{
				url: "https://storage.googleapis.com/bucket/file?X-Goog-Signature=gcs-signature-secret&X-Goog-Credential=gcs-credential-secret&mode=download",
				secrets: ["gcs-signature-secret", "gcs-credential-secret"],
			},
			{
				url: "https://account.blob.core.windows.net/container/file?sv=2026-01-01&sig=azure-signature-secret&sp=r&mode=download",
				secrets: ["azure-signature-secret"],
			},
			{
				url: "https://cdn.example.com/file?Signature=cloudfront-signature-secret&Key-Pair-Id=cloudfront-key-id&Policy=cloudfront-policy-secret&mode=download",
				secrets: ["cloudfront-signature-secret", "cloudfront-key-id", "cloudfront-policy-secret"],
			},
		];

		for (const { url, secrets } of cases) {
			const sanitized = sanitizeRecordingUrl(url);
			for (const secret of secrets) expect(sanitized).not.toContain(secret);
			expect(sanitized).toContain("mode=download");
			expect(sanitized).toContain("REDACTED");
		}
	});
});
