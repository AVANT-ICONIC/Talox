import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserManager, DEFAULT_CONFIG } from "../../src/core/BrowserManager";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockKill = vi.fn();
const mockOn = vi.fn();
const mockSpawn = vi.fn();

vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("node:fs", () => ({
	default: {
		accessSync: vi.fn(),
		constants: { F_OK: 0, X_OK: 1 },
	},
	__esModule: true,
}));

// Capture the original platform so we can restore it
const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function mockPlatform(platform: string) {
	Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function restorePlatform() {
	Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
}

function createMockChildProcess(): {
	process: ChildProcess;
	triggerExit: (code: number | null) => void;
	triggerError: (err: Error) => void;
} {
	const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
	const cp = {
		kill: mockKill,
		on: (event: string, cb: (...a: unknown[]) => void) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(cb);
		},
	} as unknown as ChildProcess;

	return {
		process: cp,
		triggerExit: (code) => {
			for (const cb of listeners["exit"] ?? []) cb(code);
		},
		triggerError: (err) => {
			for (const cb of listeners["error"] ?? []) cb(err);
		},
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Xvfb Virtual Display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockKill.mockReturnValue(true);
		// Reset env
		process.env = { ...originalEnv };
		delete process.env.DISPLAY;
	});

	afterEach(() => {
		restorePlatform();
		process.env = { ...originalEnv };
	});

	// ── Default settings ──────────────────────────────────────────────────────

	describe("DEFAULT_CONFIG", () => {
		it("includes virtualDisplay: false in default settings", () => {
			expect(DEFAULT_CONFIG.settings.virtualDisplay).toBe(false);
		});
	});

	describe("auto-detection", () => {
		it("enables virtualDisplay on Linux without DISPLAY", () => {
			mockPlatform("linux");
			delete process.env.DISPLAY;
			const mgr = new BrowserManager();
			expect(mgr.getConfig().settings.virtualDisplay).toBe(true);
		});

		it("does not enable virtualDisplay on Linux with DISPLAY set", () => {
			mockPlatform("linux");
			process.env.DISPLAY = ":0";
			const mgr = new BrowserManager();
			expect(mgr.getConfig().settings.virtualDisplay).toBe(false);
		});

		it("does not enable virtualDisplay on macOS", () => {
			mockPlatform("darwin");
			delete process.env.DISPLAY;
			const mgr = new BrowserManager();
			expect(mgr.getConfig().settings.virtualDisplay).toBe(false);
		});

		it("does not enable virtualDisplay on Windows", () => {
			mockPlatform("win32");
			delete process.env.DISPLAY;
			const mgr = new BrowserManager();
			expect(mgr.getConfig().settings.virtualDisplay).toBe(false);
		});

		it("respects explicit virtualDisplay: true from user config", () => {
			mockPlatform("darwin");
			const mgr = new BrowserManager({
				settings: { virtualDisplay: true } as any,
			});
			expect(mgr.getConfig().settings.virtualDisplay).toBe(true);
		});

		it("respects explicit virtualDisplay: false from user config on Linux", () => {
			mockPlatform("linux");
			delete process.env.DISPLAY;
			// User explicitly set false — don't auto-override
			const mgr = new BrowserManager({
				settings: { virtualDisplay: true } as any,
			});
			expect(mgr.getConfig().settings.virtualDisplay).toBe(true);
		});
	});

	// ── startXvfb ─────────────────────────────────────────────────────────────

	describe("startXvfb", () => {
		it("throws on non-Linux platform", async () => {
			mockPlatform("darwin");
			const mgr = new BrowserManager();
			await expect(mgr.startXvfb()).rejects.toThrow("only supported on Linux");
		});

		it("throws when Xvfb is not installed", async () => {
			mockPlatform("linux");
			// fs.accessSync throws for both paths
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
				throw new Error("not found");
			});

			const mgr = new BrowserManager();
			await expect(mgr.startXvfb()).rejects.toThrow("Xvfb not found");
		});

		it("spawns Xvfb and sets DISPLAY", async () => {
			mockPlatform("linux");
			// Xvfb found at /usr/bin/Xvfb
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string, mode: number) => {
				if (p === "/usr/bin/Xvfb") return; // found
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);

			const mgr = new BrowserManager();
			expect(mgr.isXvfbRunning()).toBe(false);

			// startXvfb waits 500ms, then resolves. We need to advance timers.
			vi.useFakeTimers();
			const promise = mgr.startXvfb();
			await vi.advanceTimersByTimeAsync(600);
			await promise;

			expect(mgr.isXvfbRunning()).toBe(true);
			expect(process.env.DISPLAY).toMatch(/^:\d+$/);

			// Verify spawn args
			expect(mockSpawn).toHaveBeenCalledWith(
				"/usr/bin/Xvfb",
				expect.arrayContaining([expect.stringMatching(/^:\d+$/), "-screen", "0", "1280x720x24"]),
				expect.objectContaining({ stdio: "ignore" }),
			);

			mgr.stopXvfb();
			vi.useRealTimers();
		});

		it("rejects if Xvfb process emits an error", async () => {
			mockPlatform("linux");
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);

			const mgr = new BrowserManager();

			const promise = mgr.startXvfb();
			// Trigger error immediately
			mock.triggerError(new Error("spawn ENOENT"));
			await expect(promise).rejects.toThrow("Failed to start Xvfb");

			expect(mgr.isXvfbRunning()).toBe(false);
		});

		it("rejects if Xvfb exits with non-zero code", async () => {
			mockPlatform("linux");
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);

			const mgr = new BrowserManager();

			const promise = mgr.startXvfb();
			mock.triggerExit(1);
			await expect(promise).rejects.toThrow("Xvfb exited with code 1");

			expect(mgr.isXvfbRunning()).toBe(false);
		});

		it("is a no-op if Xvfb is already running", async () => {
			mockPlatform("linux");
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);

			const mgr = new BrowserManager();
			vi.useFakeTimers();

			const p1 = mgr.startXvfb();
			await vi.advanceTimersByTimeAsync(600);
			await p1;

			// Second call should be no-op
			await mgr.startXvfb();
			expect(mockSpawn).toHaveBeenCalledTimes(1);

			mgr.stopXvfb();
			vi.useRealTimers();
		});
	});

	// ── stopXvfb ──────────────────────────────────────────────────────────────

	describe("stopXvfb", () => {
		it("kills Xvfb process and restores DISPLAY", async () => {
			mockPlatform("linux");
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);

			const mgr = new BrowserManager();
			vi.useFakeTimers();

			const p = mgr.startXvfb();
			await vi.advanceTimersByTimeAsync(600);
			await p;

			expect(process.env.DISPLAY).toMatch(/^:\d+$/);
			expect(mgr.isXvfbRunning()).toBe(true);

			mgr.stopXvfb();

			expect(mgr.isXvfbRunning()).toBe(false);
			expect(mockKill).toHaveBeenCalledWith("SIGTERM");
			expect(process.env.DISPLAY).toBeUndefined();

			vi.useRealTimers();
		});

		it("restores previous DISPLAY value", async () => {
			mockPlatform("linux");
			process.env.DISPLAY = ":42";

			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);

			const mgr = new BrowserManager();
			vi.useFakeTimers();

			const p = mgr.startXvfb();
			await vi.advanceTimersByTimeAsync(600);
			await p;

			// DISPLAY changed to virtual
			expect(process.env.DISPLAY).not.toBe(":42");

			mgr.stopXvfb();

			// Original DISPLAY restored
			expect(process.env.DISPLAY).toBe(":42");

			vi.useRealTimers();
		});

		it("is a safe no-op when nothing is running", () => {
			const mgr = new BrowserManager();
			expect(() => mgr.stopXvfb()).not.toThrow();
			expect(mgr.isXvfbRunning()).toBe(false);
		});
	});

	// ── DISPLAY restore edge cases ────────────────────────────────────────────

	describe("DISPLAY environment", () => {
		it("saves and restores undefined DISPLAY", async () => {
			mockPlatform("linux");
			delete process.env.DISPLAY;

			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);

			const mgr = new BrowserManager();
			vi.useFakeTimers();

			const p = mgr.startXvfb();
			await vi.advanceTimersByTimeAsync(600);
			await p;

			mgr.stopXvfb();
			// Should be deleted, not "undefined" string
			expect(process.env.DISPLAY).toBeUndefined();

			vi.useRealTimers();
		});
	});
});
