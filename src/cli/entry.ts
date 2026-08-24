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
		// Preserve the existing CLI unchanged for every command not owned by the
		// thin entry router. talox.ts executes main() at module load using process.argv.
		await import("./talox.js");
	}
} catch (error) {
	console.error("[Talox CLI] Failed", error);
	process.exit(1);
}
