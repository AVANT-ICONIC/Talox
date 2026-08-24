from pathlib import Path

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()

anchor = '''\t\tconst child = spawn(xvfbPath, [display, "-screen", "0", "1280x720x24", "-ac", "-nolisten", "tcp"], {
\t\t\tstdio: "ignore",
\t\t\tdetached: false,
\t\t});
\t\tthis.xvfbProcess = child;
'''
replacement = '''\t\tlet child: ChildProcess;
\t\ttry {
\t\t\tchild = spawn(xvfbPath, [display, "-screen", "0", "1280x720x24", "-ac", "-nolisten", "tcp"], {
\t\t\t\tstdio: "ignore",
\t\t\t\tdetached: false,
\t\t\t});
\t\t} catch (error) {
\t\t\treservedXvfbDisplays.delete(display);
\t\t\tthis.xvfbDisplay = null;
\t\t\tthrow new Error(`Failed to start Xvfb: ${error instanceof Error ? error.message : String(error)}`);
\t\t}
\t\tthis.xvfbProcess = child;
'''
if anchor not in text:
    raise SystemExit("Xvfb spawn anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\t\tconst launchOptions = this.buildLaunchOptions(extraOptions, actualBrowserType);

\t\t// Compute hash of launch options to detect config changes
'''
replacement = '''\t\tconst launchOptions = this.buildLaunchOptions(extraOptions, actualBrowserType);
\t\tif (this.xvfbDisplay) {
\t\t\t// DISPLAY is process-global, so overlapping managers can change it between
\t\t\t// startXvfb() readiness and Chromium spawn. Pin this launch to the Xvfb
\t\t\t// instance owned by this manager instead of trusting ambient process.env.
\t\t\tlaunchOptions.env = { ...process.env, DISPLAY: this.xvfbDisplay };
\t\t}

\t\t// Compute hash of launch options to detect config changes
'''
if anchor not in text:
    raise SystemExit("launch options anchor not found")
manager.write_text(text)

# Add a regression for a synchronous spawn throw releasing the reserved display.
tests = Path("tests/unit/XvfbDisplay.test.ts")
test_text = tests.read_text()
anchor = '''\t\tit("rejects if Xvfb process emits an error", async () => {
'''
insert = '''\t\tit("releases the reserved display when spawn throws synchronously", async () => {
\t\t\tmockPlatform("linux");
\t\t\t(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
\t\t\t\tif (p === "/usr/bin/Xvfb") return;
\t\t\t\tthrow new Error("not found");
\t\t\t});
\t\t\tmockSpawn.mockImplementationOnce(() => {
\t\t\t\tthrow new Error("spawn exploded");
\t\t\t});
\t\t\tconst mgr = new BrowserManager();
\t\t\tawait expect(mgr.startXvfb()).rejects.toThrow("Failed to start Xvfb: spawn exploded");
\t\t\texpect(mgr.isXvfbRunning()).toBe(false);

\t\t\tconst retry = createMockChildProcess();
\t\t\tmockSpawn.mockReturnValueOnce(retry.process);
\t\t\tvi.useFakeTimers();
\t\t\tconst retryStart = mgr.startXvfb();
\t\t\texpect((mockSpawn.mock.calls[1]?.[1] as string[])[0]).toBe(":99");
\t\t\tawait vi.advanceTimersByTimeAsync(600);
\t\t\tawait retryStart;
\t\t\tmgr.stopXvfb();
\t\t\tvi.useRealTimers();
\t\t});

'''
if anchor not in test_text:
    raise SystemExit("Xvfb error-test anchor not found")
tests.write_text(test_text.replace(anchor, insert + anchor, 1))
