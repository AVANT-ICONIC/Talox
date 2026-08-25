from pathlib import Path

path = Path("tests/unit/BrowserManager.test.ts")
text = path.read_text()
old = '''\t\tit("keeps same-profile ownership reserved while replacing a browser context", async () => {
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
new = '''\t\tit("keeps same-profile ownership reserved while replacing a browser context", async () => {
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
\t\t\tlet relaunch: Promise<ReturnType<typeof createMockContext>> | null = null;

\t\t\ttry {
\t\t\t\tawait manager.launch(profile, false, "chromium", { args: ["--first-profile-launch"] });
\t\t\t\trelaunch = manager.launch(profile, false, "chromium", { args: ["--replacement-profile-launch"] }) as Promise<ReturnType<typeof createMockContext>>;
\t\t\t\tawait vi.waitFor(() => expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2));

\t\t\t\tawait expect(competingManager.launch(profile)).rejects.toThrow("PROFILE_IN_USE");
\t\t\t\texpect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2);

\t\t\t\tresolveReplacement(replacementContext);
\t\t\t\tawait expect(relaunch).resolves.toBe(replacementContext);
\t\t\t} finally {
\t\t\t\tresolveReplacement(replacementContext);
\t\t\t\tif (relaunch) await relaunch.catch(() => undefined);
\t\t\t\tawait manager.close().catch(() => undefined);
\t\t\t\tawait competingManager.close().catch(() => undefined);
\t\t\t}
\t\t});
'''
if old not in text:
    raise SystemExit("profile relaunch regression anchor not found")
path.write_text(text.replace(old, new, 1))
