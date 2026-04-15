import { describe, expect, it } from "vitest";
import { BugEngine } from "../../src/core/BugEngine";
import type { TaloxBug } from "../../src/types/index";

function makeBug(overrides: Partial<TaloxBug> = {}): TaloxBug {
	return {
		id: "bug-1",
		type: "JS_ERROR",
		severity: "CRITICAL",
		description: "Console error detected: Uncaught TypeError",
		evidence: { error: "Uncaught TypeError: x is not a function" },
		...overrides,
	};
}

describe("BugEngine", () => {
	const engine = new BugEngine();

	describe("formatReport", () => {
		it("formats a single bug as markdown", () => {
			const bug = makeBug();
			const report = engine.formatReport(bug);
			expect(report).toContain("JS_ERROR");
			expect(report).toContain("CRITICAL");
			expect(report).toContain("bug-1");
			expect(report).toContain("Uncaught TypeError");
			expect(report).toContain("Severity");
		});

		it("includes evidence as JSON block", () => {
			const bug = makeBug({ evidence: { url: "https://example.com" } });
			const report = engine.formatReport(bug);
			expect(report).toContain("```json");
			expect(report).toContain("https://example.com");
		});

		it("handles bugs with complex evidence", () => {
			const bug = makeBug({
				evidence: { el: { tagName: "div" }, overlapArea: 5000 },
			});
			const report = engine.formatReport(bug);
			expect(report).toContain("overlapArea");
		});
	});

	describe("generateReport", () => {
		it('returns "no bugs" message for empty array', () => {
			const report = engine.generateReport([]);
			expect(report).toContain("No bugs detected");
		});

		it("generates a report header with count", () => {
			const bugs = [makeBug({ id: "b1" }), makeBug({ id: "b2" })];
			const report = engine.generateReport(bugs);
			expect(report).toContain("2 potential issues");
		});

		it("separates multiple bugs with ---", () => {
			const bugs = [
				makeBug({ id: "b1", type: "JS_ERROR", description: "Error A" }),
				makeBug({ id: "b2", type: "VISUAL_OVERLAP", description: "Overlap B" }),
			];
			const report = engine.generateReport(bugs);
			expect(report).toContain("---");
			expect(report).toContain("JS_ERROR");
			expect(report).toContain("VISUAL_OVERLAP");
		});

		it("formats single bug report correctly", () => {
			const bugs = [makeBug()];
			const report = engine.generateReport(bugs);
			expect(report).toContain("Bug Report");
			expect(report).toContain("1 potential issues");
		});
	});
});
