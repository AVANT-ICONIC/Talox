export function normalizeTopLevelHelpArgv(argv: string[]): string[] {
	const first = argv[0];
	if (first === "--help" || first === "-h") {
		// The legacy CLI owns the canonical usage text through its command parsers.
		// Route top-level help through a no-side-effect command parser so it prints
		// that same usage text and exits successfully instead of hitting the
		// unknown-command branch.
		return ["init", "--help"];
	}
	return argv;
}
