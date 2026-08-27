import { describe, expect, it } from "vitest";
import { ArtifactBuilder } from "../../src/core/ArtifactBuilder.js";

const REDACTED = "[REDACTED]";

function expectAbsentEverywhere(builder: ArtifactBuilder, secrets: string[]): void {
	const surfaces = [
		JSON.stringify(builder.getTrace()),
		JSON.stringify(builder.toActionFrames()),
		builder.exportAsJSON(),
		builder.exportAsText(),
		builder.exportAsActionFrames(),
	];
	for (const surface of surfaces) {
		for (const secret of secrets) expect(surface).not.toContain(secret);
	}
}

describe("ArtifactBuilder credential safety", () => {
	it("never retains literal text for type/input actions", () => {
		const builder = new ArtifactBuilder();
		const typedSecret = "correct-horse-battery-staple";

		builder.addAction("type", { selector: "#password", text: typedSecret, hasAttentionFrame: false });

		const action = builder.getTrace().actions[0]!;
		expect(action.payload.text).toBe(REDACTED);
		expect(action.payload.textLength).toBe(typedSecret.length);
		expect(action.payload.selector).toBe("#password");
		expectAbsentEverywhere(builder, [typedSecret]);
	});

	it("redacts value-style input payloads while preserving useful metadata", () => {
		const builder = new ArtifactBuilder();
		const typedSecret = "plain-input-secret";

		builder.addAction("INPUT", { selector: "input[name=secret]", value: typedSecret, source: "agent" });

		const action = builder.getTrace().actions[0]!;
		expect(action.payload.value).toBe(REDACTED);
		expect(action.payload.valueLength).toBe(typedSecret.length);
		expect(action.payload.source).toBe("agent");
		expectAbsentEverywhere(builder, [typedSecret]);
	});

	it("recursively sanitizes URL, nested, and credential-shaped payload values", () => {
		const builder = new ArtifactBuilder();
		const urlPassword = "url-password-secret";
		const queryToken = "query-token-secret";
		const bearer = "bearer-action-secret";
		const nestedPassword = "nested-password-secret";
		const url = `https://user:${urlPassword}@example.com/callback?token=${queryToken}&mode=debug`;

		builder.addAction("openPage", {
			url,
			nested: { password: nestedPassword },
			diagnostic: `Authorization: Bearer ${bearer}`,
		});

		const action = builder.getTrace().actions[0]!;
		expect(action.payload.url).toContain("mode=debug");
		expect(action.payload.nested.password).toBe(REDACTED);
		expectAbsentEverywhere(builder, [urlPassword, queryToken, bearer, nestedPassword]);
	});
});
