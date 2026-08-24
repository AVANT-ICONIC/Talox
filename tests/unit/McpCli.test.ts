import { describe, expect, it } from "vitest";
import { shouldUseMcpCommand } from "../../src/cli/mcp.js";

describe("MCP CLI routing", () => {
	it("claims the mcp command", () => {
		expect(shouldUseMcpCommand(["mcp"])).toBe(true);
		expect(shouldUseMcpCommand(["mcp", "--help"])).toBe(true);
	});

	it("does not claim other Talox commands", () => {
		expect(shouldUseMcpCommand(["run", "goal"])).toBe(false);
		expect(shouldUseMcpCommand(["observe"])).toBe(false);
		expect(shouldUseMcpCommand([])).toBe(false);
	});
});
