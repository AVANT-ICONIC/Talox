#!/usr/bin/env node

import { runMcpCommand, shouldUseMcpCommand } from "./mcp.js";
import { runMultiAgentRun, shouldUseMultiAgentRun } from "./multi-agent-run.js";
import { normalizeTopLevelHelpArgv } from "./normalize-argv.js";

const rawArgv = process.argv.slice(2);
const argv = normalizeTopLevelHelpArgv(rawArgv);

if (argv !== rawArgv) {
	process.argv.splice(2, rawArgv.length, ...argv);
}

try {
	if (shouldUseMcpCommand(argv)) {
		await runMcpCommand(argv.slice(1));
	} else if (shouldUseMultiAgentRun(argv)) {
		await runMultiAgentRun(argv.slice(1));
	} else {
		// Preserve the existing CLI unchanged for every other command.
		// talox.ts executes its own main() at module load using the same process.argv.
		await import("./talox.js");
	}
} catch (error) {
	console.error("[Talox CLI] Failed", error);
	process.exit(1);
}
