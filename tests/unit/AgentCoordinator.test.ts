/**
 * @file AgentCoordinator.test.ts
 * @description Tests for AgentCoordinator — task distribution, result merging, round-robin.
 */

import { describe, expect, it } from "vitest";
import type { AgentTask } from "../../src/core/AgentCoordinator.js";
import { AgentCoordinator } from "../../src/core/AgentCoordinator.js";

// ─── Construction ─────────────────────────────────────────────────────────────

describe("AgentCoordinator", () => {
	it("defaults to 2 agents", () => {
		const c = new AgentCoordinator();
		expect(c.agentCount).toBe(2);
	});

	it("accepts custom agent count", () => {
		const c = new AgentCoordinator({ agents: 5 });
		expect(c.agentCount).toBe(5);
	});

	it("accepts custom baseDir", () => {
		const c = new AgentCoordinator({ baseDir: "/tmp/test" });
		expect(c.agentCount).toBe(2); // default
	});

	it("throws when run() called before launch()", async () => {
		const c = new AgentCoordinator({ agents: 1 });
		await expect(c.run([])).rejects.toThrow("not launched");
	});

	it("getStatus returns status for all agents", () => {
		const c = new AgentCoordinator({ agents: 3 });
		const status = c.getStatus();
		expect(status).toHaveLength(3);
		expect(status[0]!.profileId).toBe("agent-0");
		expect(status[1]!.profileId).toBe("agent-1");
		expect(status[2]!.profileId).toBe("agent-2");
	});

	it("getAgent returns undefined for out-of-range", () => {
		const c = new AgentCoordinator({ agents: 2 });
		expect(c.getAgent(0)).toBeUndefined(); // not launched yet
		expect(c.getAgent(5)).toBeUndefined();
	});
});

// ─── mapToAgents ──────────────────────────────────────────────────────────────

describe("mapToAgents", () => {
	it("distributes items round-robin", () => {
		const c = new AgentCoordinator({ agents: 3 });
		const items = ["a", "b", "c", "d", "e"];
		const tasks = c.mapToAgents(items, (item) => ({
			action: "navigate" as const,
			params: { url: `https://${item}.com` },
		}));

		expect(tasks).toHaveLength(5);
		expect(tasks[0]!.agentId).toBe(0); // a → agent 0
		expect(tasks[1]!.agentId).toBe(1); // b → agent 1
		expect(tasks[2]!.agentId).toBe(2); // c → agent 2
		expect(tasks[3]!.agentId).toBe(0); // d → agent 0
		expect(tasks[4]!.agentId).toBe(1); // e → agent 1
	});

	it("handles single agent", () => {
		const c = new AgentCoordinator({ agents: 1 });
		const tasks = c.mapToAgents(["x", "y", "z"], (item) => ({
			action: "getState" as const,
		}));

		expect(tasks).toHaveLength(3);
		for (const t of tasks) {
			expect(t.agentId).toBe(0);
		}
	});

	it("handles empty items", () => {
		const c = new AgentCoordinator({ agents: 3 });
		const tasks = c.mapToAgents([], (item: string) => ({
			action: "getState" as const,
		}));
		expect(tasks).toHaveLength(0);
	});

	it("preserves action and params in factory", () => {
		const c = new AgentCoordinator({ agents: 2 });
		const tasks = c.mapToAgents(["test"], (item) => ({
			action: "click" as const,
			params: { selector: `#${item}` },
		}));

		expect(tasks[0]!.action).toBe("click");
		expect(tasks[0]!.params?.selector).toBe("#test");
	});
});

// ─── Task types ───────────────────────────────────────────────────────────────

describe("AgentTask", () => {
	it("validate task shapes", () => {
		const navigate: AgentTask = { agentId: 0, action: "navigate", params: { url: "https://x.com" } };
		expect(navigate.action).toBe("navigate");

		const click: AgentTask = { agentId: 1, action: "click", params: { selector: "#btn" } };
		expect(click.params?.selector).toBe("#btn");

		const type: AgentTask = {
			agentId: 0,
			action: "type",
			params: { selector: "input", text: "hello" },
		};
		expect(type.params?.text).toBe("hello");

		const state: AgentTask = { agentId: 2, action: "getState" };
		expect(state.params).toBeUndefined();

		const wait: AgentTask = { agentId: 0, action: "wait", params: { ms: "500" } };
		expect(wait.params?.ms).toBe("500");
	});
});
