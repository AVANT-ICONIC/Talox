/** Shared Chromium launch safety. These flags must survive caller overrides. */
export function chromeLaunchArgs(args: readonly string[] = []): string[] {
	return [
		...args.filter((arg) => !arg.startsWith("--password-store=") && !arg.startsWith("--use-mock-keychain=")),
		"--use-mock-keychain",
		"--password-store=basic",
	].filter((arg, index, all) => all.indexOf(arg) === index);
}
