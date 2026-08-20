#!/usr/bin/env node

import { runMultiAgentRun, shouldUseMultiAgentRun } from "./multi-agent-run.js";

const argv = process.argv.slice(2);

try {
	if (shouldUseMultiAgentRun(argv)) {
		await runMultiAgentRun(argv.slice(1));
	} else {
		// Preserve the existing CLI unchanged for every non-multi-agent command.
		// talox.ts executes its own main() at module load using the same process.argv.
		await import("./talox.js");
	}
} catch (error) {
	console.error("[Talox CLI] Failed", error);
	process.exit(1);
}
