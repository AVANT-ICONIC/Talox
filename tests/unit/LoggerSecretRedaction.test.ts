import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, redactLogString, setLogLevel } from "../../src/core/Logger.js";

describe("Logger credential redaction", () => {
	afterEach(() => {
		setLogLevel("info");
		vi.restoreAllMocks();
	});

	it("redacts sensitive query parameters and URL user info", () => {
		const secret = "abcdefgh12345678";
		const value = redactLogString(`blocked https://user:password@example.com/path?token=${secret}&page=1`);

		expect(value).toContain("https://[REDACTED]@example.com/path?token=[REDACTED]&page=1");
		expect(value).not.toContain(secret);
		expect(value).not.toContain("user:password");
	});

	it("redacts labeled secrets outside query strings", () => {
		const secret = "abcdefgh12345678";
		const value = redactLogString(`blocked https://example.com/redirect/token=${secret}/next`);

		expect(value).not.toContain(secret);
		expect(value).toContain("token=[REDACTED]");
	});

	it("redacts bearer and explicit API-key values", () => {
		const value = redactLogString("Authorization: Bearer abcdefgh12345678 X-API-Key=supersecret123");

		expect(value).not.toContain("abcdefgh12345678");
		expect(value).not.toContain("supersecret123");
		expect(value).toContain("Authorization: [REDACTED]");
		expect(value).toContain("X-API-Key=[REDACTED]");
	});

	it("redacts JWT-shaped values", () => {
		const jwt = "eyJabcdefghij.abcdefghijklmnop.qrstuvwxyz123456";
		const value = redactLogString(`request ${jwt}`);

		expect(value).toContain("[REDACTED_JWT]");
		expect(value).not.toContain(jwt);
	});

	it("redacts strings before console output while preserving benign arguments", () => {
		setLogLevel("error");
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = createLogger("SecurityTest");
		const metadata = { requestId: "safe-123" };

		logger.error("blocked https://example.com/?api_key=abcdefgh12345678", metadata);

		expect(consoleSpy).toHaveBeenCalledWith(
			"[Talox SecurityTest]",
			"blocked https://example.com/?api_key=[REDACTED]",
			metadata,
		);
	});
});
