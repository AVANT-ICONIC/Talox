import { setLogLevel } from "../core/Logger.js";
import { TaloxMcpStdioServer } from "../core/mcp/TaloxMcpServer.js";

const MCP_USAGE = `Usage:\n  talox mcp\n\nStarts the Talox MCP server over stdio. stdout is reserved for MCP JSON-RPC frames.`;

export function shouldUseMcpCommand(argv: string[]): boolean {
	return argv[0] === "mcp";
}

export async function runMcpCommand(args: string[]): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		console.log(MCP_USAGE);
		return;
	}
	if (args.length > 0) {
		throw new Error(`Unknown talox mcp option: ${args[0]}`);
	}

	// MCP stdio owns stdout. Talox core logs use the level-gated logger, and
	// this redirect catches any remaining console.log calls from older modules.
	setLogLevel("silent");
	const originalConsoleLog = console.log;
	console.log = (...values: unknown[]) => console.error(...values);

	const server = new TaloxMcpStdioServer();
	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		await server.close().catch((error: unknown) => {
			console.error("[Talox MCP] shutdown failed", error);
		});
		process.exit(0);
	};

	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	console.error("[Talox MCP] stdio server ready");

	try {
		await server.run();
	} finally {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		console.log = originalConsoleLog;
	}
}
