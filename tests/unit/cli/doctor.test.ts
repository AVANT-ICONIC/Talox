import { beforeAll, describe, expect, it } from "vitest";
import type { DoctorCheck, DoctorResult } from "../../../src/cli/doctor.js";
import { formatDoctorOutput, runDoctor } from "../../../src/cli/doctor.js";

// ---------------------------------------------------------------------------
// formatDoctorOutput
// ---------------------------------------------------------------------------

describe("formatDoctorOutput", () => {
	const VERSION = "1.2.3";

	it("formats an all-passing result", () => {
		const checks: DoctorCheck[] = [
			{ name: "Node.js version", status: "ok", message: "v20.11.0" },
			{ name: "Playwright runtime", status: "ok", message: "v1.58.2" },
			{ name: "Browser binaries", status: "ok", message: "Chromium available" },
		];

		const result: DoctorResult = {
			checks,
			passed: 3,
			warnings: 0,
			errors: 0,
			timestamp: new Date().toISOString(),
		};

		const output = formatDoctorOutput(result, VERSION);

		expect(output).toContain(`Talox Doctor — v${VERSION}`);
		expect(output).toContain("3 passed");
		expect(output).not.toContain("warning");
		expect(output).not.toContain("error");
		for (const check of checks) {
			expect(output).toContain(check.name);
			expect(output).toContain(check.message);
		}
	});

	it("formats errors and warnings with fix hints", () => {
		const checks: DoctorCheck[] = [
			{ name: "Node.js version", status: "ok", message: "v20.11.0" },
			{
				name: "Playwright runtime",
				status: "error",
				message: "playwright-core not found",
				fixHint: "npm install playwright-core",
			},
			{
				name: "Display server",
				status: "warning",
				message: "No DISPLAY or WAYLAND_DISPLAY set",
				fixHint: "Set DISPLAY environment variable",
			},
		];

		const result: DoctorResult = {
			checks,
			passed: 1,
			warnings: 1,
			errors: 1,
			timestamp: new Date().toISOString(),
		};

		const output = formatDoctorOutput(result, VERSION);

		expect(output).toContain("1 passed");
		expect(output).toContain("1 warning");
		expect(output).toContain("1 error");
		expect(output).toContain("npm install playwright-core");
		expect(output).toContain("Set DISPLAY environment variable");
	});

	it("handles empty checks array", () => {
		const result: DoctorResult = {
			checks: [],
			passed: 0,
			warnings: 0,
			errors: 0,
			timestamp: new Date().toISOString(),
		};

		const output = formatDoctorOutput(result, VERSION);

		expect(output).toContain(`Talox Doctor — v${VERSION}`);
		const lines = output.split("\n");
		const separatorLines = lines.filter((l) => l.includes("━"));
		expect(separatorLines.length).toBeGreaterThanOrEqual(2);
	});

	it("includes the horizontal separator", () => {
		const result: DoctorResult = {
			checks: [{ name: "Test", status: "ok", message: "fine" }],
			passed: 1,
			warnings: 0,
			errors: 0,
			timestamp: new Date().toISOString(),
		};

		const output = formatDoctorOutput(result, VERSION);
		expect(output).toContain("━");
	});

	it("pluralizes warnings and errors correctly", () => {
		const result: DoctorResult = {
			checks: [
				{ name: "A", status: "warning", message: "a" },
				{ name: "B", status: "warning", message: "b" },
				{ name: "C", status: "error", message: "c" },
				{ name: "D", status: "error", message: "d" },
				{ name: "E", status: "error", message: "e" },
			],
			passed: 0,
			warnings: 2,
			errors: 3,
			timestamp: new Date().toISOString(),
		};

		const output = formatDoctorOutput(result, VERSION);

		expect(output).toContain("2 warnings");
		expect(output).toContain("3 errors");
	});

	it("uses singular form when count is 1", () => {
		const result: DoctorResult = {
			checks: [
				{ name: "A", status: "warning", message: "a" },
				{ name: "B", status: "error", message: "b" },
			],
			passed: 0,
			warnings: 1,
			errors: 1,
			timestamp: new Date().toISOString(),
		};

		const output = formatDoctorOutput(result, VERSION);

		expect(output).toContain("1 warning");
		expect(output).toContain("1 error");
	});
});

// ---------------------------------------------------------------------------
// runDoctor
// ---------------------------------------------------------------------------

describe("runDoctor", () => {
	let result: DoctorResult;

	beforeAll(async () => {
		result = await runDoctor({ fix: false });
	}, 30_000);

	it("returns a valid DoctorResult shape", () => {
		expect(result).toHaveProperty("checks");
		expect(result).toHaveProperty("passed");
		expect(result).toHaveProperty("warnings");
		expect(result).toHaveProperty("errors");
		expect(result).toHaveProperty("timestamp");
		expect(Array.isArray(result.checks)).toBe(true);
		expect(result.checks.length).toBeGreaterThan(0);
		expect(typeof result.passed).toBe("number");
		expect(typeof result.warnings).toBe("number");
		expect(typeof result.errors).toBe("number");
		expect(typeof result.timestamp).toBe("string");
	});

	it("checks the production Playwright runtime", () => {
		const playwrightCheck = result.checks.find((check) => check.name === "Playwright runtime");
		expect(playwrightCheck).toBeDefined();
		expect(result.checks.some((check) => check.name === "Playwright installed")).toBe(false);
	});

	it("has consistent check counts", () => {
		const countedPassed = result.checks.filter((c) => c.status === "ok").length;
		const countedWarnings = result.checks.filter((c) => c.status === "warning").length;
		const countedErrors = result.checks.filter((c) => c.status === "error").length;

		expect(result.passed).toBe(countedPassed);
		expect(result.warnings).toBe(countedWarnings);
		expect(result.errors).toBe(countedErrors);
	});

	it("every check has required fields", () => {
		for (const check of result.checks) {
			expect(check).toHaveProperty("name");
			expect(check).toHaveProperty("status");
			expect(check).toHaveProperty("message");
			expect(["ok", "warning", "error"]).toContain(check.status);
			expect(typeof check.name).toBe("string");
			expect(typeof check.message).toBe("string");
		}
	});

	it("timestamp is a valid ISO date string", () => {
		const parsed = Date.parse(result.timestamp);
		expect(Number.isNaN(parsed)).toBe(false);
	});
});
