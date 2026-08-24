from pathlib import Path

# 1) Reject an already-owned persistent profile before browser discovery/Xvfb.
manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()
anchor = '''\tprivate claimPersistentProfileOwnership(userDataDir: string): void {
\t\tconst profileDir = canonicalProfileDir(userDataDir);
\t\tif (this.ownedProfileDir === profileDir) return;
\t\tif (activePersistentProfileDirs.has(profileDir)) {
\t\t\tthrow new Error(`PROFILE_IN_USE: Persistent profile is already active in this process: ${userDataDir}`);
\t\t}
\t\tactivePersistentProfileDirs.add(profileDir);
\t\tthis.ownedProfileDir = profileDir;
\t}
'''
replacement = '''\tprivate assertPersistentProfileAvailable(userDataDir: string): void {
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
'''
if anchor not in text:
    raise SystemExit("profile claim anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\t): Promise<BrowserContext> {
\t\tconst actualBrowserType = await this.resolveBrowserType(browserType);
'''
replacement = '''\t): Promise<BrowserContext> {
\t\t// Duplicate persistent profiles are a deterministic local conflict. Check
\t\t// before browser discovery or Xvfb startup so the error is genuinely fast.
\t\tthis.assertPersistentProfileAvailable(profile.userDataDir);
\t\tconst actualBrowserType = await this.resolveBrowserType(browserType);
'''
if anchor not in text:
    raise SystemExit("launch precheck anchor not found")
text = text.replace(anchor, replacement, 1)

anchor = '''\t\tthis.claimPersistentProfileOwnership(profile.userDataDir);
\t\tthis.launchOptionsHash = newHash;
'''
replacement = '''\t\ttry {
\t\t\tthis.claimPersistentProfileOwnership(profile.userDataDir);
\t\t} catch (error) {
\t\t\t// A concurrent launch may have claimed the profile after the early check.
\t\t\t// Tear down any Xvfb started by this otherwise-idle manager before failing.
\t\t\tif (this.context === null && this.ownedProfileDir === null) this.stopXvfb();
\t\t\tthrow error;
\t\t}
\t\tthis.launchOptionsHash = newHash;
'''
if anchor not in text:
    raise SystemExit("profile claim call anchor not found")
manager.write_text(text)

# 2) Surface only selector parser failures during preflight. Valid selectors that
# are absent or temporarily unavailable keep the existing recovery behavior.
reliability = Path("src/core/InteractionReliability.ts")
rtext = reliability.read_text()
anchor = '''const WRONG_TAB_PATTERNS = [/target.*closed/i, /execution context.*destroyed/i, /page.*closed/i];
'''
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
    raise SystemExit("selector pattern anchor not found")
rtext = rtext.replace(anchor, replacement, 1)
anchor = '''\t\t} catch (e: unknown) {
\t\t\t// Not a fatal pre-flight error — the element might still be findable
\t\t\tattempts.push({
'''
replacement = '''\t\t} catch (e: unknown) {
\t\t\t// Invalid selector syntax is deterministic. Propagate it immediately so
\t\t\t// callers do not pay the full action timeout for an impossible retry.
\t\t\tif (isSelectorSyntaxError(e)) throw e;
\t\t\t// Other pre-flight errors are non-fatal — the element might still be findable.
\t\t\tattempts.push({
'''
if anchor not in rtext:
    raise SystemExit("preflight catch anchor not found")
reliability.write_text(rtext.replace(anchor, replacement, 1))

# 3) Unit coverage for parser fast-fail.
unit = Path("tests/unit/InteractionReliability.test.ts")
utext = unit.read_text()
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
if anchor not in utext:
    raise SystemExit("InteractionReliability test anchor not found")
unit.write_text(utext.replace(anchor, replacement, 1))

# 4) Make the browser integration profile-conflict expectation deterministic.
error_test = Path("tests/core/error-paths.test.ts")
etext = error_test.read_text()
anchor = '''\t\t// Second launch on the same profile may succeed (Playwright allows multiple
\t\t// contexts) or may throw — both are acceptable. We just verify it doesn't hang.
\t\ttry {
\t\t\tawait talox2.launch("conflict-profile", "sandbox", "chromium");
\t\t} catch {
\t\t\t// Expected — Playwright may lock the profile directory
\t\t}
'''
replacement = '''\t\t// Talox owns persistent profiles exclusively within the process. A duplicate
\t\t// owner must fail before browser startup rather than waiting on Chrome locks.
\t\tawait expect(talox2.launch("conflict-profile", "sandbox", "chromium")).rejects.toThrow("PROFILE_IN_USE");
'''
if anchor not in etext:
    raise SystemExit("error-path profile conflict anchor not found")
error_test.write_text(etext.replace(anchor, replacement, 1))
