import { serveTaloxMcpStdio } from "../core/mcp/TaloxMcpServer.js";

export function shouldUseMcpCommand(argv: string[]): boolean {
	return argv[0] === "mcp";
}

function printMcpUsage(): void {
	console.log(`Talox MCP server

Usage:
  talox mcp

Runs Talox as a Model Context Protocol server over stdio.
Stdout is reserved for MCP protocol traffic; diagnostics are written to stderr.`);
}

export async function runMcpCommand(args: string[]): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		printMcpUsage();
		return;
	}
	if (args.length > 0) {
		throw new Error(`Unknown MCP option: ${args[0]}`);
	}

	serveTaloxMcpStdio();
	console.error("[Talox MCP] Server running on stdio");
}
