/**
 * @file AgentCoordinator.test.ts
 * @description Tests for AgentCoordinator — task distribution, shared state, conflict handling, and status snapshots.
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
		expect(c.agentCount).toBe(2);
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
		expect(status.every((agent) => !agent.busy)).toBe(true);
	});

	it("getStatus returns snapshots rather than mutable internal objects", () => {
		const c = new AgentCoordinator({ agents: 1 });
		const status = c.getStatus();
		status[0]!.busy = true;
		expect(c.getStatus()[0]!.busy).toBe(false);
	});

	it("getAgent returns undefined for out-of-range", () => {
		const c = new AgentCoordinator({ agents: 2 });
		expect(c.getAgent(0)).toBeUndefined();
		expect(c.getAgent(5)).toBeUndefined();
	});
});

// ─── Shared state ─────────────────────────────────────────────────────────────

describe("shared state", () => {
	it("seeds initial shared state", () => {
		const c = new AgentCoordinator({ initialSharedState: { query: "crm", page: 1 } });
		expect(c.getSharedState()).toEqual({ query: "crm", page: 1 });
		expect(c.getSharedValue<string>("query")).toBe("crm");
	});

	it("writes a new key without conflict", () => {
		const c = new AgentCoordinator();
		const result = c.setSharedValue("winner", { agentId: 0 });
		expect(result.accepted).toBe(true);
		expect(result.conflict).toBeUndefined();
		expect(c.getSharedValue("winner")).toEqual({ agentId: 0 });
	});

	it("treats identical values as idempotent writes", () => {
		const shared = { value: 42 };
		const c = new AgentCoordinator({ initialSharedState: { answer: shared } });
		const result = c.setSharedValue("answer", shared, "reject");
		expect(result.accepted).toBe(true);
		expect(result.conflict).toBeUndefined();
	});

	it("uses last-write-wins by default", () => {
		const c = new AgentCoordinator({ initialSharedState: { answer: 1 } });
		const result = c.setSharedValue("answer", 2);
		expect(result.accepted).toBe(true);
		expect(result.conflict?.strategy).toBe("last-write-wins");
		expect(c.getSharedValue("answer")).toBe(2);
	});

	it("supports first-write-wins conflict handling", () => {
		const c = new AgentCoordinator({ initialSharedState: { answer: 1 } });
		const result = c.setSharedValue("answer", 2, "first-write-wins");
		expect(result.accepted).toBe(false);
		expect(result.conflict?.accepted).toBe(false);
		expect(c.getSharedValue("answer")).toBe(1);
	});

	it("supports reject conflict handling", () => {
		const c = new AgentCoordinator({ initialSharedState: { owner: "agent-0" } });
		const result = c.setSharedValue("owner", "agent-1", "reject");
		expect(result.accepted).toBe(false);
		expect(result.conflict?.strategy).toBe("reject");
		expect(c.getSharedValue("owner")).toBe("agent-0");
	});

	it("can delete and reset shared state", () => {
		const c = new AgentCoordinator({ initialSharedState: { a: 1, b: 2 } });
		expect(c.deleteSharedValue("a")).toBe(true);
		expect(c.getSharedState()).toEqual({ b: 2 });

		c.clearSharedState({ next: true });
		expect(c.getSharedState()).toEqual({ next: true });
	});

	it("rejects empty shared-state keys", () => {
		const c = new AgentCoordinator();
		expect(() => c.setSharedValue("   ", 1)).toThrow("must not be empty");
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
		expect(tasks[0]!.agentId).toBe(0);
		expect(tasks[1]!.agentId).toBe(1);
		expect(tasks[2]!.agentId).toBe(2);
		expect(tasks[3]!.agentId).toBe(0);
		expect(tasks[4]!.agentId).toBe(1);
	});

	it("handles single agent", () => {
		const c = new AgentCoordinator({ agents: 1 });
		const tasks = c.mapToAgents(["x", "y", "z"], () => ({
			action: "getState" as const,
		}));

		expect(tasks).toHaveLength(3);
		for (const task of tasks) {
			expect(task.agentId).toBe(0);
		}
	});

	it("handles empty items", () => {
		const c = new AgentCoordinator({ agents: 3 });
		const tasks = c.mapToAgents([], (_item: string) => ({
			action: "getState" as const,
		}));
		expect(tasks).toHaveLength(0);
	});

	it("preserves action, params, and merge metadata from factory", () => {
		const c = new AgentCoordinator({ agents: 2 });
		const tasks = c.mapToAgents(["test"], (item) => ({
			action: "click" as const,
			params: { selector: `#${item}` },
			resultKey: "clicked",
			conflictStrategy: "first-write-wins" as const,
		}));

		expect(tasks[0]!.action).toBe("click");
		expect(tasks[0]!.params?.selector).toBe("#test");
		expect(tasks[0]!.resultKey).toBe("clicked");
		expect(tasks[0]!.conflictStrategy).toBe("first-write-wins");
	});
});

// ─── Task types ───────────────────────────────────────────────────────────────

describe("AgentTask", () => {
	it("validates task shapes", () => {
		const navigate: AgentTask = {
			agentId: 0,
			action: "navigate",
			params: { url: "https://x.com" },
			resultKey: "page",
		};
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

		const wait: AgentTask = { agentId: 0, action: "wait", params: { ms: 500 } };
		expect(wait.params?.ms).toBe(500);
	});
});
