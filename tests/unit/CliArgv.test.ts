import { describe, expect, it } from "vitest";
import { normalizeTopLevelHelpArgv } from "../../src/cli/normalize-argv.js";

describe("normalizeTopLevelHelpArgv", () => {
	it("routes --help through the canonical legacy usage path", () => {
		expect(normalizeTopLevelHelpArgv(["--help"])).toEqual(["init", "--help"]);
	});

	it("routes -h through the canonical legacy usage path", () => {
		expect(normalizeTopLevelHelpArgv(["-h"])).toEqual(["init", "--help"]);
	});

	it("treats top-level help as authoritative even when trailing arguments are present", () => {
		expect(normalizeTopLevelHelpArgv(["--help", "ignored"])).toEqual(["init", "--help"]);
	});

	it("leaves ordinary commands untouched", () => {
		const argv = ["run", "Inspect the page", "--agents", "2"];
		expect(normalizeTopLevelHelpArgv(argv)).toBe(argv);
	});
});
