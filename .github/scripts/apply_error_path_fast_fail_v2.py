from pathlib import Path

# BrowserManager persistent-profile ownership with relaunch-safe reservation.
manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()
anchor = '''const processCleanupCallbacks = new Set<() => void>();
let processCleanupHandlersInstalled = false;
const reservedXvfbDisplays = new Set<string>();
'''
replacement = '''const processCleanupCallbacks = new Set<() => void>();
let processCleanupHandlersInstalled = false;
const activePersistentProfileDirs = new Set<string>();
const reservedXvfbDisplays = new Set<string>();

function canonicalProfileDir(userDataDir: string): string {
\tconst resolved = path.resolve(userDataDir);
\treturn process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
'''
if anchor not in text:
    raise SystemExit("module registry anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\tprivate readonly contexts: Set<BrowserContext> = new Set();
\tprivate readonly processCleanup = () => this.closeAllSync();

\t// Xvfb virtual display state
'''
replacement = '''\tprivate readonly contexts: Set<BrowserContext> = new Set();
\tprivate readonly processCleanup = () => this.closeAllSync();
\tprivate ownedProfileDir: string | null = null;
\tprivate profileOwnerContext: BrowserContext | null = null;

\t// Xvfb virtual display state
'''
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

\tprivate assertPersistentProfileAvailable(userDataDir: string): void {
\t\tconst profileDir = canonicalProfileDir(userDataDir);
\t\tif (this.ownedProfileDir !== profileDir && activePersistentProfileDirs.has(profileDir)) {
\t\t\tthrow new Error(`PROFILE_IN_USE: Persistent profile is already active in this process: ${userDataDir}`);
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

\tprivate async closeContextForRelaunch(): Promise<void> {
\t\tconst ctx = this.context;
\t\tif (!ctx) return;
\t\tawait ctx.close();
\t\tthis.contexts.delete(ctx);
\t\tif (this.context === ctx) this.context = null;
\t\tthis.unregisterProcessCleanupIfIdle();
\t}
'''
replacement = '''\tprivate attachCloseHandler(ctx: BrowserContext): void {
\t\tctx.on("close", () => {
\t\t\tthis.contexts.delete(ctx);
\t\t\tif (this.context === ctx) this.context = null;
\t\t\tif (this.profileOwnerContext === ctx) this.releasePersistentProfileOwnership();
\t\t\tthis.unregisterProcessCleanupIfIdle();
\t\t});
\t}

\tprivate async closeContextForRelaunch(preserveProfileOwnership: boolean): Promise<void> {
\t\tconst ctx = this.context;
\t\tif (!ctx) return;
\t\tconst detachedProfileOwner = preserveProfileOwnership && this.profileOwnerContext === ctx;
\t\tif (detachedProfileOwner) this.profileOwnerContext = null;
\t\ttry {
\t\t\tawait ctx.close();
\t\t} catch (error) {
\t\t\tif (detachedProfileOwner && this.ownedProfileDir !== null && this.profileOwnerContext === null) {
\t\t\t\tthis.profileOwnerContext = ctx;
\t\t\t}
\t\t\tthrow error;
\t\t}
\t\tthis.contexts.delete(ctx);
\t\tif (this.context === ctx) this.context = null;
\t\tthis.unregisterProcessCleanupIfIdle();
\t}
'''
if anchor not in text:
    raise SystemExit("context close anchor not found")
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

anchor = '''\t): Promise<BrowserContext> {
\t\tconst actualBrowserType = await this.resolveBrowserType(browserType);
'''
replacement = '''\t): Promise<BrowserContext> {
\t\t// A duplicate persistent profile is a deterministic local conflict. Reject it
\t\t// before browser discovery or Xvfb startup instead of waiting on Chrome locks.
\t\tthis.assertPersistentProfileAvailable(profile.userDataDir);
\t\tconst actualBrowserType = await this.resolveBrowserType(browserType);
'''
if anchor not in text:
    raise SystemExit("launch precheck anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\t\t// Close only the browser context when launch configuration changes. Keep an
\t\t// owned Xvfb alive because launchOptions may already be pinned to that display.
\t\tif (this.context) {
\t\t\tawait this.closeContextForRelaunch();
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
replacement = '''\t\t// Close only the browser context when launch configuration changes. Keep an
\t\t// owned Xvfb alive because launchOptions may already be pinned to that display.
\t\tif (this.context) {
\t\t\tconst targetProfileDir = canonicalProfileDir(profile.userDataDir);
\t\t\tawait this.closeContextForRelaunch(this.ownedProfileDir === targetProfileDir);
\t\t}

\t\ttry {
\t\t\tthis.claimPersistentProfileOwnership(profile.userDataDir);
\t\t} catch (error) {
\t\t\t// Another launch may have won the race after the early availability check.
\t\t\t// An otherwise-idle manager should not keep a freshly-started Xvfb alive.
\t\t\tif (this.context === null && this.ownedProfileDir === null) this.stopXvfb();
\t\t\tthrow error;
\t\t}
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
manager.write_text(text.replace(anchor, replacement, 1))

# Selector parser errors should fail before the 5-second action timeout.
reliability = Path("src/core/InteractionReliability.ts")
rtext = reliability.read_text()
anchor = 'const WRONG_TAB_PATTERNS = [/target.*closed/i, /execution context.*destroyed/i, /page.*closed/i];\n'
replacement = '''const WRONG_TAB_PATTERNS = [/target.*closed/i, /execution context.*destroyed/i, /page.*closed/i];
const INVALID_SELECTOR_PATTERNS = [
\t/while parsing css selector/i,
\t/unexpected token.*css selector/i,
\t/unknown engine .* while parsing selector/i,
\t/malformed selector/i,
];

function isSelectorSyntaxError(error: unknown): boolean {
\tconst message = error instanceof Error ? error.message : String(error);
\treturn INVALID_SELECTOR_PATTERNS.some((pattern) => pattern.test(message));
}
'''
if anchor not in rtext:
    raise SystemExit("selector patterns anchor not found")
rtext = rtext.replace(anchor, replacement, 1)
anchor = '''\t\t} catch (e: unknown) {
\t\t\t// Not a fatal pre-flight error — the element might still be findable
\t\t\tattempts.push({
'''
replacement = '''\t\t} catch (e: unknown) {
\t\t\t// Invalid syntax is deterministic. Do not pay the full click/type timeout
\t\t\t// for a selector Playwright has already proven impossible to parse.
\t\t\tif (isSelectorSyntaxError(e)) throw e;
\t\t\t// Other pre-flight errors remain recoverable; the element may still appear.
\t\t\tattempts.push({
'''
if anchor not in rtext:
    raise SystemExit("preflight catch anchor not found")
reliability.write_text(rtext.replace(anchor, replacement, 1))

# BrowserManager unit coverage and unique profile paths to isolate module-global ownership.
tests = Path("tests/unit/BrowserManager.test.ts")
t = tests.read_text()
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
if anchor not in t:
    raise SystemExit("profile helper anchor not found")
t = t.replace(anchor, replacement, 1)
anchor = '''\t\tit("stores the context for later retrieval", async () => {
\t\t\tconst mockCtx = createMockContext();
\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

\t\t\tawait manager.launch(createTestProfile());
\t\t\texpect(manager.getContext()).toBe(mockCtx);
\t\t});
'''
insert = anchor + '''
\t\tit("rejects a second owner of the same persistent profile before browser launch", async () => {
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
\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("browser not found"));
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

\t\tit("keeps same-profile ownership reserved while replacing a browser context", async () => {
\t\t\tconst firstContext = createMockContext();
\t\t\tconst replacementContext = createMockContext();
\t\t\tlet resolveReplacement!: (ctx: ReturnType<typeof createMockContext>) => void;
\t\t\tconst replacementLaunch = new Promise<ReturnType<typeof createMockContext>>((resolve) => {
\t\t\t\tresolveReplacement = resolve;
\t\t\t});
\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
\t\t\t\t.mockResolvedValueOnce(firstContext)
\t\t\t\t.mockImplementationOnce(() => replacementLaunch);
\t\t\tconst competingManager = new BrowserManager({
\t\t\t\tbrowser: { preferred: "chromium", headless: true, autoDetect: false } as any,
\t\t\t\tsettings: { adaptiveStealthEnabled: false } as any,
\t\t\t});
\t\t\tconst profile = createTestProfile("relaunch-profile");

\t\t\tawait manager.launch(profile, false, "chromium", { viewport: { width: 800, height: 600 } });
\t\t\tconst relaunch = manager.launch(profile, false, "chromium", { viewport: { width: 1024, height: 768 } });
\t\t\tawait vi.waitFor(() => expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2));

\t\t\tawait expect(competingManager.launch(profile)).rejects.toThrow("PROFILE_IN_USE");
\t\t\texpect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2);

\t\t\tresolveReplacement(replacementContext);
\t\t\tawait expect(relaunch).resolves.toBe(replacementContext);
\t\t\tawait manager.close();
\t\t});
'''
if anchor not in t:
    raise SystemExit("BrowserManager test insertion anchor not found")
tests.write_text(t.replace(anchor, insert, 1))

# InteractionReliability unit regression.
unit = Path("tests/unit/InteractionReliability.test.ts")
u = unit.read_text()
anchor = '''\t\tit("returns resolved=true even if scroll throws (non-fatal)", async () => {
\t\t\tconst page = makePage({ $: vi.fn().mockRejectedValue(new Error("not found")) });
\t\t\tconst result = await reliability.resolveBeforeClick(page, "#missing", []);
\t\t\texpect(result.resolved).toBe(true);
\t\t});
'''
replacement = anchor + '''
\t\tit("fails immediately when Playwright reports malformed CSS syntax", async () => {
\t\t\tconst syntaxError = new Error('Unexpected token "" while parsing css selector "[[[invalid"');
\t\t\tconst page = makePage({ $: vi.fn().mockRejectedValue(syntaxError) });

\t\t\tawait expect(reliability.resolveBeforeClick(page, "[[[invalid", [])).rejects.toBe(syntaxError);
\t\t});
'''
if anchor not in u:
    raise SystemExit("InteractionReliability unit anchor not found")
unit.write_text(u.replace(anchor, replacement, 1))

# Browser integration profile conflict becomes deterministic and measurable.
error_test = Path("tests/core/error-paths.test.ts")
e = error_test.read_text()
anchor = '''\t\t// Second launch on the same profile may succeed (Playwright allows multiple
\t\t// contexts) or may throw — both are acceptable. We just verify it doesn't hang.
\t\ttry {
\t\t\tawait talox2.launch("conflict-profile", "sandbox", "chromium");
\t\t} catch {
\t\t\t// Expected — Playwright may lock the profile directory
\t\t}
'''
replacement = '''\t\t// Persistent profiles have one in-process owner. A duplicate must fail before
\t\t// browser discovery/startup rather than waiting on Chrome's profile lock.
\t\tawait expect(talox2.launch("conflict-profile", "sandbox", "chromium")).rejects.toThrow("PROFILE_IN_USE");
'''
if anchor not in e:
    raise SystemExit("error-path profile conflict anchor not found")
error_test.write_text(e.replace(anchor, replacement, 1))
