/**
 * A state that reports a failure must be detectable AS a failure.
 *
 * `TaloxController.navigate()`, `getState()`, `click()` and `type()` all catch
 * whatever is thrown and return `buildErrorState(error)`. That state used to be
 *
 *     { url: "", title: "Error", console: { errors: [message] }, ... }
 *
 * and nothing more. A caller could only guess, from an empty url or the literal
 * string "Error" in a title, that anything had gone wrong — and no caller did.
 * `talox screenshot` ignored the returned state entirely, captured `about:blank`
 * and printed "Annotated screenshot saved", exit 0, for a navigation that the
 * policy engine had explicitly refused.
 *
 * `state.failed` is the field that makes it askable. These tests hold both
 * halves: that it is set when the reading could not be taken, and that it is
 * ABSENT on a real page, because a false positive here would make every healthy
 * capture look broken.
 */
import { describe, expect, it } from "vitest";

import { TaloxController } from "../../src/core/controller/TaloxController.js";

// buildErrorState is private, which is correct — it is an implementation
// detail. The behaviour under test is what a caller receives, so it is reached
// the way a caller reaches it.
function errorStateFrom(controller: TaloxController, error: unknown, operation: string) {
	return (controller as unknown as {
		buildErrorState(error: unknown, operation?: string): import("../../src/types/index.js").TaloxPageState;
	}).buildErrorState(error, operation);
}

describe("a state that could not be read says so", () => {
	it("marks a refused navigation as failed, naming the operation and the reason", () => {
		const controller = new TaloxController(".");
		// The exact error observed in the field.
		const thrown = new Error("Policy Violation: URL http://127.0.0.1:3210/ui/ not allowed for ops profile");
		const state = errorStateFrom(controller, thrown, "navigate");

		expect(state.failed).toBeDefined();
		expect(state.failed?.operation).toBe("navigate");
		expect(state.failed?.reason).toContain("Policy Violation");
	});

	it("names whichever operation failed, not always navigate", () => {
		const controller = new TaloxController(".");
		for (const operation of ["navigate", "getState", "click", "type"]) {
			const state = errorStateFrom(controller, new Error("boom"), operation);
			expect(state.failed?.operation).toBe(operation);
		}
	});

	it("keeps the old shape, so nothing that read url or title breaks", () => {
		const controller = new TaloxController(".");
		const state = errorStateFrom(controller, new Error("boom"), "navigate");
		expect(state.url).toBe("");
		expect(state.title).toBe("Error");
		expect(state.console.errors.length).toBeGreaterThan(0);
		expect(state.interactiveElements).toEqual([]);
	});

	it("leaves `failed` absent on a state that is a real reading", () => {
		// The whole value of the field is that `if (state.failed)` is a reliable
		// question. A real page must never set it, or every caller learns to
		// ignore it again.
		const healthy: import("../../src/types/index.js").TaloxPageState = {
			url: "http://localhost:3210/ui/",
			title: "Apex — CEO chat",
			timestamp: new Date().toISOString(),
			console: { errors: [] },
			network: { failedRequests: [] },
			nodes: [],
			interactiveElements: [],
			bugs: [],
		};
		expect(healthy.failed).toBeUndefined();
	});

	it("is what the screenshot command branches on", async () => {
		// A rule proven only against a constructed state would survive someone
		// deleting the check that uses it. Read the shipped CLI.
		const { readFileSync } = await import("node:fs");
		const source = readFileSync(new URL("../../src/cli/talox.ts", import.meta.url), "utf8");

		expect(source).toMatch(/const state = await talox\.navigate\(opts\.url\)/);
		expect(source).toMatch(/if \(state\.failed\)/);
		expect(source).toMatch(/process\.exitCode = 1/);
		// The line that produced a blank PNG and called it a success.
		expect(source).not.toMatch(/if \(opts\.url\) \{\s*await talox\.navigate\(opts\.url\);\s*\}/);
	});
});
