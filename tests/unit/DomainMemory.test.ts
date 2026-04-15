import { describe, expect, it } from "vitest";
import { DomainMemory } from "../../src/core/smart/DomainMemory";

describe("DomainMemory", () => {
	describe("extractHostname", () => {
		const m = new DomainMemory();
		it("extracts eTLD+1 from full URL", () => {
			expect(m.extractHostname("https://www.reddit.com/r/all")).toBe("reddit.com");
		});
		it("handles subdomains", () => {
			expect(m.extractHostname("https://app.example.com/dashboard")).toBe("example.com");
		});
		it("handles URLs without subdomains", () => {
			expect(m.extractHostname("https://github.com/octocat")).toBe("github.com");
		});
		it("falls back to raw value on invalid URL", () => {
			expect(m.extractHostname("not-a-url")).toBe("not-a-url");
		});
	});

	describe("record + getScore", () => {
		it("creates a new record on first call", () => {
			const m = new DomainMemory();
			m.record("https://example.com/login", "stealth_escalation", false);
			const s = m.getScore("https://example.com/page", "stealth_escalation");
			expect(s).not.toBeNull();
			expect(s!.attempts).toBe(1);
			expect(s!.successes).toBe(0);
			expect(s!.successRate).toBe(0);
		});

		it("increments attempts on repeated calls", () => {
			const m = new DomainMemory();
			m.record("https://example.com", "stealth_nudge", true);
			m.record("https://example.com", "stealth_nudge", true);
			m.record("https://example.com", "stealth_nudge", false);
			const s = m.getScore("https://example.com", "stealth_nudge")!;
			expect(s.attempts).toBe(3);
			expect(s.successes).toBe(2);
			expect(s.successRate).toBeCloseTo(2 / 3);
		});

		it("returns null for unknown domain", () => {
			const m = new DomainMemory();
			expect(m.getScore("https://unknown.com", "stealth_nudge")).toBeNull();
		});

		it("returns null for unknown strategy on known domain", () => {
			const m = new DomainMemory();
			m.record("https://example.com", "stealth_nudge", true);
			expect(m.getScore("https://example.com", "nonexistent_strategy")).toBeNull();
		});
	});

	describe("EWMA", () => {
		it("ewmaSuccessRate converges toward 1.0 after repeated successes", () => {
			const m = new DomainMemory({ ewmaAlpha: 0.5 });
			for (let i = 0; i < 10; i++) m.record("https://example.com", "s", true);
			const score = m.getScore("https://example.com", "s")!;
			expect(score.ewmaSuccessRate).toBeGreaterThan(0.9);
		});

		it("ewmaSuccessRate converges toward 0.0 after repeated failures", () => {
			const m = new DomainMemory({ ewmaAlpha: 0.5 });
			for (let i = 0; i < 10; i++) m.record("https://example.com", "s", false);
			const score = m.getScore("https://example.com", "s")!;
			expect(score.ewmaSuccessRate).toBeLessThan(0.1);
		});

		it("ewmaSuccessRate is between 0 and 1", () => {
			const m = new DomainMemory();
			m.record("https://example.com", "s", true);
			m.record("https://example.com", "s", false);
			const score = m.getScore("https://example.com", "s")!;
			expect(score.ewmaSuccessRate).toBeGreaterThanOrEqual(0);
			expect(score.ewmaSuccessRate).toBeLessThanOrEqual(1);
		});
	});

	describe("getBestStrategy", () => {
		it("returns strategy with highest EWMA success rate", () => {
			const m = new DomainMemory({ ewmaAlpha: 0.5 });
			m.record("https://reddit.com", "stealth_nudge", false);
			m.record("https://reddit.com", "stealth_escalation", true);
			m.record("https://reddit.com", "stealth_escalation", true);
			const best = m.getBestStrategy("https://reddit.com");
			expect(best?.strategy).toBe("stealth_escalation");
		});

		it("returns null for unknown domain", () => {
			const m = new DomainMemory();
			expect(m.getBestStrategy("https://unknown.com")).toBeNull();
		});
	});

	describe("getRankedStrategies", () => {
		it("returns strategies sorted by ewmaSuccessRate descending", () => {
			const m = new DomainMemory({ ewmaAlpha: 0.9 });
			m.record("https://example.com", "a", true);
			m.record("https://example.com", "b", false);
			m.record("https://example.com", "c", true);
			m.record("https://example.com", "c", true);

			const ranked = m.getRankedStrategies("https://example.com");
			expect(ranked.length).toBe(3);
			for (let i = 1; i < ranked.length; i++) {
				expect(ranked[i - 1]!.ewmaSuccessRate).toBeGreaterThanOrEqual(ranked[i]!.ewmaSuccessRate);
			}
		});

		it("returns empty array for unknown domain", () => {
			const m = new DomainMemory();
			expect(m.getRankedStrategies("https://unknown.com")).toEqual([]);
		});
	});

	describe("domainCount", () => {
		it("counts distinct hostnames", () => {
			const m = new DomainMemory();
			m.record("https://reddit.com", "stealth", true);
			m.record("https://twitter.com", "backoff", false);
			m.record("https://www.reddit.com/r/all", "stealth", false); // same domain
			expect(m.domainCount).toBe(2);
		});
	});

	describe("toJSON / fromJSON", () => {
		it("round-trips all records", () => {
			const m1 = new DomainMemory();
			m1.record("https://example.com", "stealth_nudge", true);
			m1.record("https://example.com", "stealth_nudge", false);
			m1.record("https://reddit.com", "backoff", true);

			const snapshot = m1.toJSON();
			expect(snapshot.version).toBe(1);

			const m2 = new DomainMemory();
			m2.fromJSON(snapshot);

			const s1 = m2.getScore("https://example.com", "stealth_nudge")!;
			expect(s1.attempts).toBe(2);
			expect(s1.successes).toBe(1);

			const s2 = m2.getScore("https://reddit.com", "backoff")!;
			expect(s2.attempts).toBe(1);
		});

		it("ignores unknown schema versions", () => {
			const m = new DomainMemory();
			m.fromJSON({ version: 99 as any, exportedAt: "", domains: {} });
			expect(m.domainCount).toBe(0);
		});
	});

	describe("getDomainRecord", () => {
		it("returns total events count", () => {
			const m = new DomainMemory();
			m.record("https://example.com", "a", true);
			m.record("https://example.com", "b", false);
			const rec = m.getDomainRecord("https://example.com")!;
			expect(rec.totalEvents).toBe(2);
		});

		it("returns null for unknown domain", () => {
			const m = new DomainMemory();
			expect(m.getDomainRecord("https://unknown.com")).toBeNull();
		});
	});

	describe("lastSeen timestamps", () => {
		it("lastSeen is updated on each record call", () => {
			const m = new DomainMemory();
			m.record("https://example.com", "stealth", true);
			const t1 = m.getScore("https://example.com", "stealth")!.lastSeen;
			m.record("https://example.com", "stealth", false);
			const t2 = m.getScore("https://example.com", "stealth")!.lastSeen;
			// Both should be valid ISO strings; t2 >= t1
			expect(new Date(t2).getTime()).toBeGreaterThanOrEqual(new Date(t1).getTime());
		});
	});
});
