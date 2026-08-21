import { execFile } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ENTRY_PATH = path.resolve(process.cwd(), "dist", "cli", "entry.js");

function runEntry(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		execFile(
			"node",
			[ENTRY_PATH, ...args],
			{
				timeout: 15_000,
				env: { ...process.env, OPENAI_API_KEY: "" },
			},
			(error, stdout, stderr) => {
				resolve({
					stdout: (stdout ?? "").trim(),
					stderr: (stderr ?? "").trim(),
					code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
				});
			},
		);
	});
}

describe("published CLI entry", () => {
	it("routes --agents > 1 into coordinated mode before browser launch", async () => {
		const result = await runEntry(["run", "compare vendors", "--agents", "2"]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain("Multi-agent run requires an API key");
	});

	it("delegates help to the existing CLI", async () => {
		const result = await runEntry(["run", "--help", "--agents", "2"]);

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Usage:");
		expect(result.stdout).toContain("--agents");
	});
});
