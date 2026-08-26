import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../../src/core/PolicyEngine.js";

describe("PolicyEngine domain boundaries", () => {
	it("rejects lookalike, userinfo, and query-string bypasses for the default ops allowlist", () => {
		const engine = new PolicyEngine();

		expect(engine.isAllowed("ops", "https://github.com/org/repo")).toBe(true);
		expect(engine.isAllowed("ops", "https://api.github.com/repos/org/repo")).toBe(true);
		expect(engine.isAllowed("ops", "https://github.com.attacker.test/org/repo")).toBe(false);
		expect(engine.isAllowed("ops", "https://github.com@attacker.test/org/repo")).toBe(false);
		expect(engine.isAllowed("ops", "https://attacker.test/?next=github.com")).toBe(false);
	});

	it("keeps about:blank and localhost behavior without substring matching", () => {
		const engine = new PolicyEngine();

		expect(engine.isAllowed("ops", "about:blank")).toBe(true);
		expect(engine.isAllowed("ops", "http://localhost:3000/app")).toBe(true);
		expect(engine.isAllowed("ops", "https://notlocalhost.test/?q=localhost")).toBe(false);
	});

	it("applies the same hostname boundaries to YAML domain rules", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("qa", {
			defaultEffect: "deny",
			rules: [{ action: "navigate", effect: "allow", domains: ["trusted.example"] }],
		});

		expect(engine.isAllowed("qa", "https://trusted.example/page")).toBe(true);
		expect(engine.isAllowed("qa", "https://api.trusted.example/page")).toBe(true);
		expect(engine.isAllowed("qa", "https://trusted.example.attacker.test/page")).toBe(false);
		expect(engine.isAllowed("qa", "https://attacker.test/?next=trusted.example")).toBe(false);
	});

	it("supports URL-shaped and wildcard-subdomain YAML domain patterns safely", () => {
		const engine = new PolicyEngine();
		engine.setPolicyForProfile("qa", {
			defaultEffect: "deny",
			rules: [
				{ action: "navigate", effect: "allow", domains: ["https://safe.example", "*.service.example"] },
			],
		});

		expect(engine.isAllowed("qa", "https://safe.example/path")).toBe(true);
		expect(engine.isAllowed("qa", "https://sub.service.example/path")).toBe(true);
		expect(engine.isAllowed("qa", "https://safe.example.attacker.test/path")).toBe(false);
	});
});
