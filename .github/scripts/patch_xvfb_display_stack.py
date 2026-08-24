from pathlib import Path
import re

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()

anchor = '''const processCleanupCallbacks = new Set<() => void>();
let processCleanupHandlersInstalled = false;
'''
replacement = '''const processCleanupCallbacks = new Set<() => void>();
let processCleanupHandlersInstalled = false;
const reservedXvfbDisplays = new Set<string>();
const activeXvfbDisplays: Array<{ child: ChildProcess; display: string }> = [];
let baseDisplayEnv: string | undefined;
let baseDisplayEnvCaptured = false;

function activateXvfbDisplay(child: ChildProcess, display: string): void {
\tif (activeXvfbDisplays.some((entry) => entry.child === child)) return;
\tif (activeXvfbDisplays.length === 0) {
\t\tbaseDisplayEnv = process.env.DISPLAY;
\t\tbaseDisplayEnvCaptured = true;
\t}
\tactiveXvfbDisplays.push({ child, display });
\tprocess.env.DISPLAY = display;
}

function deactivateXvfbDisplay(child: ChildProcess): void {
\tconst index = activeXvfbDisplays.findIndex((entry) => entry.child === child);
\tif (index < 0) return;
\tconst wasActiveDisplay = index === activeXvfbDisplays.length - 1;
\tactiveXvfbDisplays.splice(index, 1);
\tif (!wasActiveDisplay) return;

\tconst previous = activeXvfbDisplays.at(-1);
\tif (previous) {
\t\tprocess.env.DISPLAY = previous.display;
\t\treturn;
\t}

\tif (baseDisplayEnvCaptured && baseDisplayEnv !== undefined) {
\t\tprocess.env.DISPLAY = baseDisplayEnv;
\t} else {
\t\tdelete process.env.DISPLAY;
\t}
\tbaseDisplayEnv = undefined;
\tbaseDisplayEnvCaptured = false;
}
'''
if anchor not in text:
    raise SystemExit("process cleanup globals anchor not found")
text = text.replace(anchor, replacement, 1)

text = text.replace('\tprivate savedDisplayEnv: string | undefined;\n', '', 1)

pattern = re.compile(r'''\tprivate static findFreeDisplay\(\): number \{.*?\n\t\}\n\n\t/\*\* Release Xvfb state only when the supplied child still owns it\. \*/\n\tprivate releaseXvfbOwnership\(.*?\n\t\}\n\n\t/\*\*\n\t \* Start Xvfb and set DISPLAY for headed Chromium on a virtual framebuffer\.''', re.S)
replacement = '''\tprivate static findFreeDisplay(): number {
\t\tfor (let display = 99; display < 200; display++) {
\t\t\tconst displayName = `:${display}`;
\t\t\tif (reservedXvfbDisplays.has(displayName)) continue;
\t\t\tconst lockFile = `/tmp/.X${display}-lock`;
\t\t\ttry {
\t\t\t\tfs.accessSync(lockFile, fs.constants.F_OK);
\t\t\t} catch {
\t\t\t\treservedXvfbDisplays.add(displayName);
\t\t\t\treturn display;
\t\t\t}
\t\t}
\t\tthrow new Error("No free X display available in the :99-:199 range.");
\t}

\t/** Release Xvfb state only when the supplied child still owns it. */
\tprivate releaseXvfbOwnership(child: ChildProcess, display: string, terminate: boolean): void {
\t\t// Child events can arrive after a failed start has already been retried.
\t\t// Only the process that still owns the manager state may clear it.
\t\tif (this.xvfbProcess !== child) return;

\t\tif (terminate) {
\t\t\ttry {
\t\t\t\tchild.kill("SIGTERM");
\t\t\t} catch {
\t\t\t\t/* NOSONAR — process may already be gone */
\t\t\t}
\t\t}

\t\tthis.xvfbProcess = null;
\t\tif (this.xvfbDisplay === display) {
\t\t\tdeactivateXvfbDisplay(child);
\t\t\treservedXvfbDisplays.delete(display);
\t\t\tthis.xvfbDisplay = null;
\t\t}
\t\tthis.unregisterProcessCleanupIfIdle();
\t}

\t/**
\t * Start Xvfb and set DISPLAY for headed Chromium on a virtual framebuffer.'''
updated, count = pattern.subn(lambda _: replacement, text)
if count != 1:
    raise SystemExit(f"display allocation/release replacement count={count}")
text = updated

text = text.replace('''\t\tconst display = `:${displayNum}`;
\t\tconst savedDisplayEnv = process.env.DISPLAY;
\t\tthis.xvfbDisplay = display;
\t\tthis.savedDisplayEnv = savedDisplayEnv;
''', '''\t\tconst display = `:${displayNum}`;
\t\tthis.xvfbDisplay = display;
''', 1)
text = text.replace('this.releaseXvfbOwnership(child, display, savedDisplayEnv, true);', 'this.releaseXvfbOwnership(child, display, true);')
text = text.replace('this.releaseXvfbOwnership(child, display, savedDisplayEnv, false);', 'this.releaseXvfbOwnership(child, display, false);')
text = text.replace('''\t\tprocess.env.DISPLAY = display;
\t}
''', '''\t\tactivateXvfbDisplay(child, display);
\t}
''', 1)

pattern = re.compile(r'''\tstopXvfb\(\): void \{.*?\n\t\}\n\n\t/\*\*\n\t \* Whether Xvfb is currently running\.''', re.S)
replacement = '''\tstopXvfb(): void {
\t\tconst child = this.xvfbProcess;
\t\tconst display = this.xvfbDisplay;

\t\tif (child && display) {
\t\t\tthis.releaseXvfbOwnership(child, display, true);
\t\t\treturn;
\t\t}

\t\tif (child) {
\t\t\ttry {
\t\t\t\tchild.kill("SIGTERM");
\t\t\t} catch {
\t\t\t\t/* NOSONAR — process may have already exited */
\t\t\t}
\t\t\tdeactivateXvfbDisplay(child);
\t\t\tthis.xvfbProcess = null;
\t\t}
\t\tif (display) {
\t\t\treservedXvfbDisplays.delete(display);
\t\t\tthis.xvfbDisplay = null;
\t\t}
\t\tthis.unregisterProcessCleanupIfIdle();
\t}

\t/**
\t * Whether Xvfb is currently running.'''
text, count = pattern.subn(lambda _: replacement, text)
if count != 1:
    raise SystemExit(f"stopXvfb replacement count={count}")
manager.write_text(text)

# Add regressions for overlapping display ownership and reservation.
tests = Path("tests/unit/XvfbDisplay.test.ts")
test_text = tests.read_text()
anchor = '''\t\tit("restores previous DISPLAY value", async () => {
'''
insert = '''\t\tit("restores the previous active Xvfb when overlapping managers stop in LIFO order", async () => {
\t\t\tmockPlatform("linux");
\t\t\tprocess.env.DISPLAY = ":42";
\t\t\t(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
\t\t\t\tif (p === "/usr/bin/Xvfb") return;
\t\t\t\tthrow new Error("not found");
\t\t\t});

\t\t\tconst first = createMockChildProcess();
\t\t\tconst second = createMockChildProcess();
\t\t\tmockSpawn.mockReturnValueOnce(first.process).mockReturnValueOnce(second.process);
\t\t\tconst firstManager = new BrowserManager();
\t\t\tconst secondManager = new BrowserManager();
\t\t\tvi.useFakeTimers();

\t\t\tconst firstStart = firstManager.startXvfb();
\t\t\tconst secondStart = secondManager.startXvfb();
\t\t\tawait vi.advanceTimersByTimeAsync(600);
\t\t\tawait Promise.all([firstStart, secondStart]);

\t\t\tconst firstDisplay = (mockSpawn.mock.calls[0]?.[1] as string[])[0];
\t\t\tconst secondDisplay = (mockSpawn.mock.calls[1]?.[1] as string[])[0];
\t\t\texpect(firstDisplay).toBe(":99");
\t\t\texpect(secondDisplay).toBe(":100");
\t\t\texpect(process.env.DISPLAY).toBe(":100");

\t\t\tsecondManager.stopXvfb();
\t\t\texpect(process.env.DISPLAY).toBe(":99");
\t\t\tfirstManager.stopXvfb();
\t\t\texpect(process.env.DISPLAY).toBe(":42");
\t\t\tvi.useRealTimers();
\t\t});

\t\tit("keeps the current Xvfb DISPLAY when an older manager stops first", async () => {
\t\t\tmockPlatform("linux");
\t\t\tprocess.env.DISPLAY = ":42";
\t\t\t(fs.accessSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
\t\t\t\tif (p === "/usr/bin/Xvfb") return;
\t\t\t\tthrow new Error("not found");
\t\t\t});

\t\t\tconst first = createMockChildProcess();
\t\t\tconst second = createMockChildProcess();
\t\t\tmockSpawn.mockReturnValueOnce(first.process).mockReturnValueOnce(second.process);
\t\t\tconst firstManager = new BrowserManager();
\t\t\tconst secondManager = new BrowserManager();
\t\t\tvi.useFakeTimers();

\t\t\tconst firstStart = firstManager.startXvfb();
\t\t\tconst secondStart = secondManager.startXvfb();
\t\t\tawait vi.advanceTimersByTimeAsync(600);
\t\t\tawait Promise.all([firstStart, secondStart]);
\t\t\texpect(process.env.DISPLAY).toBe(":100");

\t\t\tfirstManager.stopXvfb();
\t\t\texpect(process.env.DISPLAY).toBe(":100");
\t\t\tsecondManager.stopXvfb();
\t\t\texpect(process.env.DISPLAY).toBe(":42");
\t\t\tvi.useRealTimers();
\t\t});

'''
if anchor not in test_text:
    raise SystemExit("DISPLAY overlap test anchor not found")
tests.write_text(test_text.replace(anchor, insert + anchor, 1))
