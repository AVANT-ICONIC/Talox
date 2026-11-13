import { describe, expect, it } from "vitest";
import { DomainMemory } from "../../src/core/smart/DomainMemory";

describe("DomainMemory Snapshot Isolation", () => {
	describe("Exported snapshot isolation", () => {
		it("mutating an exported score does not affect original memory", () => {
			const original = new DomainMemory();
			original.record("https://example.com", "strategy_a", true);
			original.record("https://example.com", "strategy_a", false);
			
			const snapshot = original.toJSON();
			const exportedScore = snapshot.domains["example.com"].strategies["strategy_a"];
			
			// Mutate the exported score
			exportedScore.attempts = 999;
			exportedScore.successes = 500;
			exportedScore.successRate = 500 / 999;
			exportedScore.ewmaSuccessRate = 0.75;
			
			// Verify original memory is unchanged
			const originalScore = original.getScore("https://example.com", "strategy_a");
			expect(originalScore!.attempts).toBe(2);
			expect(originalScore!.successes).toBe(1);
			expect(originalScore!.successRate).toBe(0.5);
			expect(originalScore!.ewmaSuccessRate).toBeCloseTo(0.7); // 0.3 * 0 + 0.7 * 1 (first success)
		});

		it("recording after export does not mutate earlier exported snapshot", () => {
			const original = new DomainMemory();
			original.record("https://example.com", "strategy_b", true);
			
			const snapshot = original.toJSON();
			const exportedRecord = snapshot.domains["example.com"];
			const originalRecord = original.getDomainRecord("https://example.com")!;
			
			// Record new data in original memory after export
			original.record("https://example.com", "strategy_b", false);
			original.record("https://example.com", "strategy_c", true);
			
			// Verify exported snapshot is unchanged
			expect(exportedRecord.strategies["strategy_b"].attempts).toBe(1);
			expect(exportedRecord.strategies["strategy_b"].successes).toBe(1);
			expect(exportedRecord.totalEvents).toBe(1);
			
			// Verify original memory has updated data
			expect(originalRecord.strategies["strategy_b"].attempts).toBe(2);
			expect(originalRecord.strategies["strategy_b"].successes).toBe(1);
			expect(originalRecord.totalEvents).toBe(3);
		});
	});

	describe("Imported memory isolation", () => {
		it("mutating imported source map and score does not affect other instances", () => {
			const source = new DomainMemory();
			source.record("https://reddit.com", "stealth_escalation", true);
			source.record("https://reddit.com", "stealth_escalation", false);
			
			const snapshot = source.toJSON();
			
			// Create two separate instances from the same snapshot
			const memory1 = new DomainMemory();
			const memory2 = new DomainMemory();
			
			memory1.fromJSON(snapshot);
			memory2.fromJSON(snapshot);
			
			// Mutate the first imported memory
			const score1 = memory1.getScore("https://reddit.com", "stealth_escalation")!;
			score1.attempts = 999;
			score1.successes = 500;
			score1.successRate = 500 / 999;
			score1.ewmaSuccessRate = 0.75;
			
			// Verify second imported memory is unchanged
			const score2 = memory2.getScore("https://reddit.com", "stealth_escalation");
			expect(score2!.attempts).toBe(2);
			expect(score2!.successes).toBe(1);
			expect(score2!.successRate).toBe(0.5);
			expect(score2!.ewmaSuccessRate).toBeCloseTo(0.7); // 0.3 * 0 + 0.7 * 1 (first success)
			
			// Verify source memory is also unchanged
			const sourceScore = source.getScore("https://reddit.com", "stealth_escalation");
			expect(sourceScore!.attempts).toBe(2);
			expect(sourceScore!.successes).toBe(1);
			expect(sourceScore!.successRate).toBe(0.5);
			expect(sourceScore!.ewmaSuccessRate).toBeCloseTo(0.7); // 0.3 * 0 + 0.7 * 1 (first success)
		});

		it("importing one snapshot into two memories and updating one does not affect the other", () => {
			const source = new DomainMemory();
			source.record("https://twitter.com", "backoff", false);
			source.record("https://twitter.com", "backoff", false);
			source.record("https://twitter.com", "retry", true);
			
			const snapshot = source.toJSON();
			
			// Create two separate instances from the same snapshot
			const memoryA = new DomainMemory();
			const memoryB = new DomainMemory();
			
			memoryA.fromJSON(snapshot);
			memoryB.fromJSON(snapshot);
			
			// Update memory A
			memoryA.record("https://twitter.com", "backoff", true);
			memoryA.record("https://twitter.com", "new_strategy", false);
			
			// Verify memory B is unchanged
			const scoreA_backoff = memoryA.getScore("https://twitter.com", "backoff");
			const scoreB_backoff = memoryB.getScore("https://twitter.com", "backoff");
			
			expect(scoreA_backoff!.attempts).toBe(3);
			expect(scoreA_backoff!.successes).toBe(1);
			expect(scoreA_backoff!.successRate).toBe(1 / 3);
			
			expect(scoreB_backoff!.attempts).toBe(2);
			expect(scoreB_backoff!.successes).toBe(0);
			expect(scoreB_backoff!.successRate).toBe(0);
			
			// Verify memory B doesn't have the new strategy
			expect(memoryB.getScore("https://twitter.com", "new_strategy")).toBeNull();
			
			// Verify memory A has the new strategy
			expect(memoryA.getScore("https://twitter.com", "new_strategy")).not.toBeNull();
		});
	});

	describe("Cross-snapshot isolation", () => {
		it("multiple snapshots from the same source remain independent", () => {
			const source = new DomainMemory();
			source.record("https://github.com", "api_retry", true);
			
			const snapshot1 = source.toJSON();
			const snapshot2 = source.toJSON();
			
			// Create memories from different snapshots
			const memory1 = new DomainMemory();
			const memory2 = new DomainMemory();
			
			memory1.fromJSON(snapshot1);
			memory2.fromJSON(snapshot2);
			
			// Update memory1
			memory1.record("https://github.com", "api_retry", false);
			
			// Verify memory2 is unchanged
			const score1 = memory1.getScore("https://github.com", "api_retry");
			const score2 = memory2.getScore("https://github.com", "api_retry");
			
			expect(score1!.attempts).toBe(2);
			expect(score1!.successes).toBe(1);
			expect(score1!.successRate).toBe(0.5);
			
			expect(score2!.attempts).toBe(1);
			expect(score2!.successes).toBe(1);
			expect(score2!.successRate).toBe(1);
		});
	});

	describe("Edge cases and data integrity", () => {
		it("isolates strategies within the same domain", () => {
			const source = new DomainMemory();
			source.record("https://example.com", "strategy_x", true);
			source.record("https://example.com", "strategy_y", false);
			
			const snapshot = source.toJSON();
			const memory = new DomainMemory();
			memory.fromJSON(snapshot);
			
			// Mutate one strategy
			const scoreX = memory.getScore("https://example.com", "strategy_x")!;
			scoreX.attempts = 999;
			
			// Verify other strategy is unchanged
			const scoreY = memory.getScore("https://example.com", "strategy_y");
			expect(scoreY!.attempts).toBe(1);
			expect(scoreY!.successes).toBe(0);
		});

		it("isolates between different domains", () => {
			const source = new DomainMemory();
			source.record("https://example.com", "strategy_1", true);
			source.record("https://reddit.com", "strategy_2", false);
			
			const snapshot = source.toJSON();
			const memory = new DomainMemory();
			memory.fromJSON(snapshot);
			
			// Mutate strategy for example.com
			const score1 = memory.getScore("https://example.com", "strategy_1")!;
			score1.attempts = 999;
			
			// Verify reddit.com strategy is unchanged
			const score2 = memory.getScore("https://reddit.com", "strategy_2");
			expect(score2!.attempts).toBe(1);
			expect(score2!.successes).toBe(0);
		});

		it("preserves timestamps and metadata", () => {
			const source = new DomainMemory();
			source.record("https://example.com", "time_test", true);
			
			const beforeExport = source.getDomainRecord("https://example.com")!.updatedAt;
			
			const snapshot = source.toJSON();
			const memory = new DomainMemory();
			memory.fromJSON(snapshot);
			
			const afterImport = memory.getDomainRecord("https://example.com")!.updatedAt;
			
			// Verify timestamps are preserved and valid ISO strings
			expect(beforeExport).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
			expect(afterImport).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
			expect(beforeExport).toBe(afterImport); // Should be identical for same operation
		});
	});

	describe("Performance and memory efficiency", () => {
		it("handles large datasets efficiently", () => {
			const source = new DomainMemory();
			const domains = ["example.com", "reddit.com", "twitter.com", "github.com", "stackoverflow.com"];
			
			// Create substantial test data
			for (let i = 0; i < 100; i++) {
				for (const domain of domains) {
					source.record(`https://${domain}`, `strategy_${i % 10}`, i % 3 === 0);
				}
			}
			
			const snapshot = source.toJSON();
			const memory = new DomainMemory();
			
			// Measure import time
			const start = performance.now();
			memory.fromJSON(snapshot);
			const importTime = performance.now() - start;
			
			// Verify data integrity after import
			expect(memory.domainCount).toBe(5);
			for (const domain of domains) {
				expect(memory.getDomainRecord(`https://${domain}`)).not.toBeNull();
			}
			
			// Should complete quickly (target <50ms for synthetic data)
			expect(importTime).toBeLessThan(50);
		});
	});
});