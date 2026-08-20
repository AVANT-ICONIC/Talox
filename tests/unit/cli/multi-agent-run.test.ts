import { describe, expect, it } from "vitest";
import {
	parseMultiAgentRunOptions,
	readAgentCount,
	shouldUseMultiAgentRun,
} from "../../../src/cli/multi-agent-run.js";

describe("multi-agent run CLI routing", () => {
	it("routes run commands with more than one agent", () => {
		expect(shouldUseMultiAgentRun(["run", "compare vendors", "--agents", "3"])).toBe(true);
		expect(shouldUseMultiAgentRun(["run", "compare vendors", "--agents=4"])).toBe(true);
	});

	it("keeps single-agent and unrelated commands on the existing CLI", () => {
		expect(shouldUseMultiAgentRun(["run", "browse", "--agents", "1"])).toBe(false);
		expect(shouldUseMultiAgentRun(["observe", "--agents", "3"])).toBe(false);
		expect(shouldUseMultiAgentRun(["run", "--help", "--agents", "3"])).toBe(false);
	});

	it("rejects invalid agent counts during routing", () => {
		expect(readAgentCount(["--agents", "0"])).toBe(1);
		expect(readAgentCount(["--agents", "-2"])).toBe(1);
		expect(readAgentCount(["--agents", "banana"])).toBe(1);
	});

	it("parses coordinated run options and joins unquoted goal tokens", () => {
		const opts = parseMultiAgentRunOptions([
			"compare",
			"three",
			"vendors",
			"--agents",
			"3",
			"--url",
			"https://example.com",
			"--model",
			"test-model",
			"--base-url",
			"https://llm.example/v1",
			"--max-iterations",
			"7",
			"--strategy",
			"aggressive",
		]);

		expect(opts.goal).toBe("compare three vendors");
		expect(opts.agents).toBe(3);
		expect(opts.url).toBe("https://example.com");
		expect(opts.model).toBe("test-model");
		expect(opts.baseUrl).toBe("https://llm.example/v1");
		expect(opts.maxIterations).toBe(7);
		expect(opts.strategy).toBe("aggressive");
	});

	it("falls back safely for invalid numeric and strategy options", () => {
		const opts = parseMultiAgentRunOptions([
			"goal",
			"--agents=-10",
			"--max-iterations",
			"0",
			"--strategy",
			"chaos",
		]);

		expect(opts.agents).toBe(1);
		expect(opts.maxIterations).toBe(10);
		expect(opts.strategy).toBe("balanced");
	});
});
