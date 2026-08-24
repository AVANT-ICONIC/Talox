from pathlib import Path

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()

anchor = "const processCleanupCallbacks = new Set<() => void>();\nlet processCleanupHandlersInstalled = false;"
replacement = '''const processCleanupCallbacks = new Set<() => void>();
let processCleanupHandlersInstalled = false;
const activePersistentProfileDirs = new Set<string>();

function canonicalProfileDir(userDataDir: string): string {
\tconst resolved = path.resolve(userDataDir);
\treturn process.platform === "win32" ? resolved.toLowerCase() : resolved;
}'''
if anchor not in text:
    raise SystemExit("module registry anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = "\tprivate readonly contexts: Set<BrowserContext> = new Set();\n\tprivate readonly processCleanup = () => this.closeAllSync();"
replacement = '''\tprivate readonly contexts: Set<BrowserContext> = new Set();
\tprivate readonly processCleanup = () => this.closeAllSync();
\tprivate ownedProfileDir: string | null = null;
\tprivate profileOwnerContext: BrowserContext | null = null;'''
if anchor not in text:
    raise SystemExit("manager state anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\tprivate unregisterProcessCleanupIfIdle(): void {
\t\tif (this.contexts.size === 0 && this.xvfbProcess === null) {
\t\t\tprocessCleanupCallbacks.delete(this.processCleanup);
\t\t}
\t}
'''
replacement = '''\tprivate unregisterProcessCleanupIfIdle(): void {
\t\tif (this.contexts.size === 0 && this.xvfbProcess === null) {
\t\t\tprocessCleanupCallbacks.delete(this.processCleanup);
\t\t}
\t}

\tprivate claimPersistentProfileOwnership(userDataDir: string): void {
\t\tconst profileDir = canonicalProfileDir(userDataDir);
\t\tif (this.ownedProfileDir === profileDir) return;
\t\tif (activePersistentProfileDirs.has(profileDir)) {
\t\t\tthrow new Error(`PROFILE_IN_USE: Persistent profile is already active in this process: ${userDataDir}`);
\t\t}
\t\tactivePersistentProfileDirs.add(profileDir);
\t\tthis.ownedProfileDir = profileDir;
\t}

\tprivate releasePersistentProfileOwnership(): void {
\t\tif (this.ownedProfileDir === null) return;
\t\tactivePersistentProfileDirs.delete(this.ownedProfileDir);
\t\tthis.ownedProfileDir = null;
\t\tthis.profileOwnerContext = null;
\t}
'''
if anchor not in text:
    raise SystemExit("cleanup helper anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\tprivate closeAllSync() {
\t\t// Synchronous cleanup is limited, but we try our best
\t\tfor (const ctx of this.contexts) {
\t\t\ttry {
\t\t\t\t(ctx as any)._browser?.close().catch(() => {});
\t\t\t} catch {
\t\t\t\t/* NOSONAR */
\t\t\t}
\t\t}
\t\tthis.stopXvfb();
\t}

\tasync closeAll() {
\t\tconst promises = Array.from(this.contexts).map((ctx) => ctx.close());
\t\tawait Promise.all(promises);
\t\tthis.contexts.clear();
\t\tthis.context = null;
\t\tthis.stopXvfb();
\t}
'''
replacement = '''\tprivate closeAllSync() {
\t\t// Synchronous cleanup is limited, but we try our best
\t\tfor (const ctx of this.contexts) {
\t\t\ttry {
\t\t\t\t(ctx as any)._browser?.close().catch(() => {});
\t\t\t} catch {
\t\t\t\t/* NOSONAR */
\t\t\t}
\t\t}
\t\tthis.releasePersistentProfileOwnership();
\t\tthis.stopXvfb();
\t}

\tasync closeAll() {
\t\tconst promises = Array.from(this.contexts).map((ctx) => ctx.close());
\t\tawait Promise.all(promises);
\t\tthis.contexts.clear();
\t\tthis.context = null;
\t\tthis.releasePersistentProfileOwnership();
\t\tthis.stopXvfb();
\t}
'''
if anchor not in text:
    raise SystemExit("closeAll anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\tprivate attachCloseHandler(ctx: BrowserContext): void {
\t\tctx.on("close", () => {
\t\t\tthis.contexts.delete(ctx);
\t\t\tif (this.context === ctx) this.context = null;
\t\t\tthis.unregisterProcessCleanupIfIdle();
\t\t});
\t}
'''
replacement = '''\tprivate attachCloseHandler(ctx: BrowserContext): void {
\t\tctx.on("close", () => {
\t\t\tthis.contexts.delete(ctx);
\t\t\tif (this.context === ctx) this.context = null;
\t\t\tif (this.profileOwnerContext === ctx) {
\t\t\t\tthis.releasePersistentProfileOwnership();
\t\t\t}
\t\t\tthis.unregisterProcessCleanupIfIdle();
\t\t});
\t}
'''
if anchor not in text:
    raise SystemExit("attachCloseHandler anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\tprivate async tryLaunchContext(
\t\tlauncher: PlaywrightBrowserType,
\t\tuserDataDir: string,
\t\tlaunchOptions: Record<string, unknown>,
\t): Promise<BrowserContext> {
\t\tconst ctx = (await launcher.launchPersistentContext(userDataDir, launchOptions)) as BrowserContext;
\t\tthis.contexts.add(ctx);
\t\tthis.registerProcessCleanup();
\t\tthis.attachCloseHandler(ctx);
\t\treturn ctx;
\t}
'''
replacement = '''\tprivate async tryLaunchContext(
\t\tlauncher: PlaywrightBrowserType,
\t\tuserDataDir: string,
\t\tlaunchOptions: Record<string, unknown>,
\t): Promise<BrowserContext> {
\t\tconst ctx = (await launcher.launchPersistentContext(userDataDir, launchOptions)) as BrowserContext;
\t\tthis.contexts.add(ctx);
\t\tthis.profileOwnerContext = ctx;
\t\tthis.registerProcessCleanup();
\t\tthis.attachCloseHandler(ctx);
\t\treturn ctx;
\t}
'''
if anchor not in text:
    raise SystemExit("tryLaunchContext anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\t\t// Close existing browser if configuration changed
\t\tif (this.context) {
\t\t\tawait this.close();
\t\t}

\t\tthis.launchOptionsHash = newHash;

\t\t// Do not force chrome channel, as it conflicts if the user has Chrome open.
\t\t// Use Playwright's bundled Chromium instead.

\t\tthis.context = await this.launchWithFallback(launcher, profile.userDataDir, launchOptions, actualBrowserType);
\t\treturn this.context;
\t}

\tasync close() {
\t\tif (this.context) {
\t\t\tawait this.context.close();
\t\t\tthis.context = null;
\t\t}
\t\tthis.stopXvfb();
\t}
'''
replacement = '''\t\t// Close existing browser if configuration changed
\t\tif (this.context) {
\t\t\tawait this.close();
\t\t}

\t\t// Persistent browser profiles are not safe to open concurrently. Reject
\t\t// a second in-process owner before spawning Chrome instead of waiting for
\t\t// browser profile-lock retries/timeouts.
\t\tthis.claimPersistentProfileOwnership(profile.userDataDir);
\t\tthis.launchOptionsHash = newHash;

\t\t// Do not force chrome channel, as it conflicts if the user has Chrome open.
\t\t// Use Playwright's bundled Chromium instead.
\t\ttry {
\t\t\tthis.context = await this.launchWithFallback(launcher, profile.userDataDir, launchOptions, actualBrowserType);
\t\t\treturn this.context;
\t\t} catch (error) {
\t\t\tthis.launchOptionsHash = null;
\t\t\tthis.releasePersistentProfileOwnership();
\t\t\tthrow error;
\t\t}
\t}

\tasync close() {
\t\tif (this.context) {
\t\t\tawait this.context.close();
\t\t\tthis.context = null;
\t\t}
\t\tthis.releasePersistentProfileOwnership();
\t\tthis.stopXvfb();
\t}
'''
if anchor not in text:
    raise SystemExit("launch/close anchor not found")
text = text.replace(anchor, replacement, 1)
manager.write_text(text)

tests = Path("tests/unit/BrowserManager.test.ts")
test_text = tests.read_text()
anchor = '''function createTestProfile() {
\treturn {
\t\tid: "test-profile-1",
\t\tclass: "sandbox" as const,
\t\tpurpose: "testing",
\t\tuserDataDir: "/tmp/talox-test-profile",
\t\tmetadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
\t};
}
'''
replacement = '''let profileCounter = 0;
function createTestProfile(name = `test-profile-${++profileCounter}`) {
\treturn {
\t\tid: name,
\t\tclass: "sandbox" as const,
\t\tpurpose: "testing",
\t\tuserDataDir: `/tmp/talox-${name}`,
\t\tmetadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
\t};
}
'''
if anchor not in test_text:
    raise SystemExit("test profile helper anchor not found")
test_text = test_text.replace(anchor, replacement, 1)

anchor = '''\t\tit("stores the context for later retrieval", async () => {
\t\t\tconst mockCtx = createMockContext();
\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

\t\t\tawait manager.launch(createTestProfile());
\t\t\texpect(manager.getContext()).toBe(mockCtx);
\t\t});
'''
replacement = anchor + '''
\t\tit("rejects a second in-process owner of the same persistent profile before browser launch", async () => {
\t\t\tconst firstContext = createMockContext();
\t\t\tconst secondContext = createMockContext();
\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
\t\t\t\t.mockResolvedValueOnce(firstContext)
\t\t\t\t.mockResolvedValueOnce(secondContext);
\t\t\tconst secondManager = new BrowserManager({
\t\t\t\tbrowser: { preferred: "chromium", headless: true, autoDetect: false } as any,
\t\t\t\tsettings: { adaptiveStealthEnabled: false } as any,
\t\t\t});
\t\t\tconst profile = createTestProfile("shared-profile");

\t\t\tawait manager.launch(profile);
\t\t\tawait expect(secondManager.launch(profile)).rejects.toThrow("PROFILE_IN_USE");
\t\t\texpect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

\t\t\tawait manager.close();
\t\t\tawait expect(secondManager.launch(profile)).resolves.toBe(secondContext);
\t\t\texpect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
\t\t\tawait secondManager.close();
\t\t});

\t\tit("releases profile ownership when browser launch fails", async () => {
\t\t\tconst profile = createTestProfile("failed-profile");
\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
\t\t\t\t.mockRejectedValueOnce(new Error("browser not found"));
\t\t\tawait expect(manager.launch(profile)).rejects.toThrow();

\t\t\tconst retryContext = createMockContext();
\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(retryContext);
\t\t\tconst retryManager = new BrowserManager({
\t\t\t\tbrowser: { preferred: "chromium", headless: true, autoDetect: false } as any,
\t\t\t\tsettings: { adaptiveStealthEnabled: false } as any,
\t\t\t});
\t\t\tawait expect(retryManager.launch(profile)).resolves.toBe(retryContext);
\t\t\tawait retryManager.close();
\t\t});
'''
if anchor not in test_text:
    raise SystemExit("launch test insertion anchor not found")
tests.write_text(test_text.replace(anchor, replacement, 1))
