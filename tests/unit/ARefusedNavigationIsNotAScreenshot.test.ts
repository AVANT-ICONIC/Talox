/**
 * `talox screenshot <url>` wrote a picture of nothing and called it a success.
 *
 * MEASURED 2026-09-16 on an M1 Mac against a live local app:
 *
 *   talox screenshot http://127.0.0.1:3210/ui/  -> 5,837 byte blank PNG, exit 0,
 *                                                  "[Talox CLI] Annotated screenshot saved to ..."
 *   talox screenshot http://localhost:3210/ui/  -> 252,349 byte correct capture
 *
 * The same page. The same server. The only difference was which name for this
 * machine was typed, and the blank one still reported success.
 *
 * Two defects, and the second is the serious one:
 *
 *   1. The `ops` allowlist contains "localhost" and not "127.0.0.1". They are
 *      one machine with several spellings, so the policy refused a target the
 *      author had already decided was allowed.
 *
 *   2. `TaloxController.navigate()` catches everything and returns an error
 *      state. That state was `{ url: "", title: "Error" }` and nothing else —
 *      indistinguishable from a real page whose title happens to be "Error" —
 *      so the CLI ignored it, captured `about:blank`, wrote the file and exited
 *      0. The policy did its job and four frames above it the verdict was
 *      thrown away.
 *
 * A guard whose refusal cannot be observed is not a guard, and a tool that
 * reports an artifact it did not produce is worse than one that crashes.
 */
import { describe, expect, it } from "vitest";

import { PolicyEngine } from "../../src/core/PolicyEngine.js";

describe("the local machine is allowed by every one of its names", () => {
	// This is the exact URL that produced the blank PNG.
	it("allows the loopback IP that was refused in the field", () => {
		const policy = new PolicyEngine();
		expect(policy.isAllowed("ops", "http://127.0.0.1:3210/ui/")).toBe(true);
	});

	it("allows the hostname that worked, so the fix adds a name and removes none", () => {
		const policy = new PolicyEngine();
		expect(policy.isAllowed("ops", "http://localhost:3210/ui/")).toBe(true);
	});

	it("allows IPv6 loopback, which is the same machine again", () => {
		const policy = new PolicyEngine();
		expect(policy.isAllowed("ops", "http://[::1]:3210/ui/")).toBe(true);
	});

	it("still allows what ops could always reach", () => {
		const policy = new PolicyEngine();
		expect(policy.isAllowed("ops", "https://github.com/AVANT-ICONIC/Talox")).toBe(true);
		expect(policy.isAllowed("ops", "about:blank")).toBe(true);
	});

	it("still refuses what ops was never allowed to reach", () => {
		// The point of the ops class is that it is narrow. Widening it to the
		// local machine must not widen it to the internet.
		const policy = new PolicyEngine();
		expect(policy.isAllowed("ops", "https://example.com/")).toBe(false);
		expect(policy.isAllowed("ops", "https://evil.test/")).toBe(false);
	});

	it("does not let a hostname merely CONTAINING a loopback name through", () => {
		// `127.0.0.1.evil.test` and `localhost.evil.test` resolve to somebody
		// else's server. A substring match would hand them the ops profile.
		const policy = new PolicyEngine();
		expect(policy.isAllowed("ops", "http://127.0.0.1.evil.test/")).toBe(false);
		expect(policy.isAllowed("ops", "http://localhost.evil.test/")).toBe(false);
		expect(policy.isAllowed("ops", "http://notlocalhost/")).toBe(false);
	});
});
