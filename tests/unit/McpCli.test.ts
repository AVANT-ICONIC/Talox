import { describe, expect, it } from "vitest";
import { shouldUseMcpCommand } from "../../src/cli/mcp.js";

describe("shouldUseMcpCommand", () => {
	it("routes the mcp command through the dedicated stdio entrypoint", () => {
		expect(shouldUseMcpCommand(["mcp"])).toBe(true);
		expect(shouldUseMcpCommand(["mcp", "--help"])).toBe(true);
	});

	it("does not intercept existing Talox commands", () => {
		expect(shouldUseMcpCommand(["run", "Inspect the page"])).toBe(false);
		expect(shouldUseMcpCommand(["daemon"])).toBe(false);
	});
});
