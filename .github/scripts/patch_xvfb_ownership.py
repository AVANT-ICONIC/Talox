from pathlib import Path
import re

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()
pattern = re.compile(
    r"\tasync startXvfb\(\): Promise<void> \{.*?\n\t/\*\*\n\t \* Whether Xvfb is currently running\.",
    re.S,
)
replacement = r'''	private releaseXvfbOwnership(
		child: ChildProcess,
		display: string,
		savedDisplayEnv: string | undefined,
		terminate: boolean,
	): void {
		// Child events can arrive after a failed start has already been retried.
		// Only the process that still owns the manager state may clear it.
		if (this.xvfbProcess !== child) return;

		if (terminate) {
			try {
				child.kill("SIGTERM");
			} catch {
				/* NOSONAR — process may already be gone */
			}
		}

		this.xvfbProcess = null;
		if (this.xvfbDisplay === display) {
			if (savedDisplayEnv !== undefined) {
				process.env.DISPLAY = savedDisplayEnv;
			} else {
				delete process.env.DISPLAY;
			}
			this.xvfbDisplay = null;
			this.savedDisplayEnv = undefined;
		}
		this.unregisterProcessCleanupIfIdle();
	}

	async startXvfb(): Promise<void> {
		if (process.platform !== "linux") {
			throw new Error("Xvfb virtual display is only supported on Linux.");
		}
		if (this.xvfbProcess) {
			return; // already running
		}

		const xvfbPath = BrowserManager.findXvfb();
		if (!xvfbPath) {
			throw new Error("Xvfb not found. Install it with: sudo apt install xvfb");
		}

		const displayNum = BrowserManager.findFreeDisplay();
		const display = `:${displayNum}`;
		const savedDisplayEnv = process.env.DISPLAY;
		this.xvfbDisplay = display;
		this.savedDisplayEnv = savedDisplayEnv;

		const child = spawn(xvfbPath, [display, "-screen", "0", "1280x720x24", "-ac", "-nolisten", "tcp"], {
			stdio: "ignore",
			detached: false,
		});
		this.xvfbProcess = child;
		this.registerProcessCleanup();

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				resolve();
			}, 500);

			const failStartup = (error: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.releaseXvfbOwnership(child, display, savedDisplayEnv, true);
				reject(error);
			};

			child.on("error", (err) => {
				if (!settled) {
					failStartup(new Error(`Failed to start Xvfb: ${err.message}`));
					return;
				}
				this.releaseXvfbOwnership(child, display, savedDisplayEnv, false);
			});

			child.on("exit", (code, signal) => {
				if (!settled) {
					const error = code !== null
						? new Error(`Xvfb exited with code ${code}`)
						: new Error(`Xvfb exited before readiness with signal ${signal ?? "unknown"}`);
					failStartup(error);
					return;
				}
				this.releaseXvfbOwnership(child, display, savedDisplayEnv, false);
			});
		});

		if (this.xvfbProcess !== child) {
			throw new Error("Xvfb startup was interrupted before readiness.");
		}
		process.env.DISPLAY = display;
	}

	/**
	 * Kill the Xvfb process and restore the original DISPLAY environment.
	 */
	stopXvfb(): void {
		const child = this.xvfbProcess;
		const display = this.xvfbDisplay;
		const savedDisplayEnv = this.savedDisplayEnv;

		if (child && display) {
			this.releaseXvfbOwnership(child, display, savedDisplayEnv, true);
			return;
		}

		if (child) {
			try {
				child.kill("SIGTERM");
			} catch {
				/* NOSONAR — process may have already exited */
			}
			this.xvfbProcess = null;
		}
		if (display) {
			if (savedDisplayEnv !== undefined) {
				process.env.DISPLAY = savedDisplayEnv;
			} else {
				delete process.env.DISPLAY;
			}
			this.xvfbDisplay = null;
			this.savedDisplayEnv = undefined;
		}
		this.unregisterProcessCleanupIfIdle();
	}

	/**
	 * Whether Xvfb is currently running.'''
updated, count = pattern.subn(lambda _: replacement, text)
if count != 1:
    raise SystemExit(f"BrowserManager replacement count={count}")
manager.write_text(updated)

tests = Path("tests/unit/XvfbDisplay.test.ts")
test_text = tests.read_text()
test_pattern = re.compile(
    r'\t\tit\("registers cleanup immediately after spawn and removes it when startup fails", async \(\) => \{.*?\n\t\tit\("spawns Xvfb and sets DISPLAY",',
    re.S,
)
test_replacement = r'''		it("registers cleanup immediately after spawn and removes it when startup fails", async () => {
			mockPlatform("linux");
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const mock = createMockChildProcess();
			mockSpawn.mockReturnValue(mock.process);
			const onceSpy = vi.spyOn(process, "once").mockImplementation(() => process);
			const mgr = new BrowserManager();

			const promise = mgr.startXvfb();
			const exitRegistration = onceSpy.mock.calls.find(([event]) => event === "exit");
			expect(mockSpawn).toHaveBeenCalledTimes(1);
			expect(exitRegistration).toBeDefined();
			expect(onceSpy.mock.calls.some(([event]) => event === "SIGINT")).toBe(true);

			mock.triggerError(new Error("spawn failed"));
			await expect(promise).rejects.toThrow("Failed to start Xvfb");
			expect(mgr.isXvfbRunning()).toBe(false);
			const killCount = mockKill.mock.calls.length;

			const exitHandler = exitRegistration?.[1] as (() => void) | undefined;
			exitHandler?.();
			expect(mockKill).toHaveBeenCalledTimes(killCount);
			onceSpy.mockRestore();
		});

		it("ignores a delayed exit from a failed child after a retry owns Xvfb", async () => {
			mockPlatform("linux");
			(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
				if (p === "/usr/bin/Xvfb") return;
				throw new Error("not found");
			});

			const first = createMockChildProcess();
			const second = createMockChildProcess();
			mockSpawn.mockReturnValueOnce(first.process).mockReturnValueOnce(second.process);
			const mgr = new BrowserManager();
			vi.useFakeTimers();

			const firstStart = mgr.startXvfb();
			first.triggerError(new Error("first spawn failed"));
			await expect(firstStart).rejects.toThrow("Failed to start Xvfb");

			const secondStart = mgr.startXvfb();
			expect(mgr.isXvfbRunning()).toBe(true);
			first.triggerExit(1);
			expect(mgr.isXvfbRunning()).toBe(true);

			await vi.advanceTimersByTimeAsync(600);
			await secondStart;
			expect(mgr.isXvfbRunning()).toBe(true);
			expect(process.env.DISPLAY).toMatch(/^:\\d+$/);

			mgr.stopXvfb();
			vi.useRealTimers();
		});

		it("spawns Xvfb and sets DISPLAY",'''
updated_tests, test_count = test_pattern.subn(lambda _: test_replacement, test_text)
if test_count != 1:
    raise SystemExit(f"Xvfb test replacement count={test_count}")
tests.write_text(updated_tests)
