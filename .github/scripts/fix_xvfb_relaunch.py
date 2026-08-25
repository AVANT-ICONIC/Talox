from pathlib import Path

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()
anchor = '''\tprivate attachCloseHandler(ctx: BrowserContext): void {\n\t\tctx.on("close", () => {\n\t\t\tthis.contexts.delete(ctx);\n\t\t\tif (this.context === ctx) this.context = null;\n\t\t\tthis.unregisterProcessCleanupIfIdle();\n\t\t});\n\t}\n'''
replacement = anchor + '''\n\tprivate async closeContextForRelaunch(): Promise<void> {\n\t\tconst ctx = this.context;\n\t\tif (!ctx) return;\n\t\tawait ctx.close();\n\t\tthis.contexts.delete(ctx);\n\t\tif (this.context === ctx) this.context = null;\n\t\tthis.unregisterProcessCleanupIfIdle();\n\t}\n'''
if anchor not in text:
    raise SystemExit("attachCloseHandler anchor not found")
text = text.replace(anchor, replacement, 1)
anchor = '''\t\t// Close existing browser if configuration changed\n\t\tif (this.context) {\n\t\t\tawait this.close();\n\t\t}\n'''
replacement = '''\t\t// Close only the browser context when launch configuration changes. Keep an\n\t\t// owned Xvfb alive because launchOptions may already be pinned to that display.\n\t\tif (this.context) {\n\t\t\tawait this.closeContextForRelaunch();\n\t\t}\n'''
if anchor not in text:
    raise SystemExit("relaunch close anchor not found")
manager.write_text(text.replace(anchor, replacement, 1))

tests = Path("tests/unit/BrowserManager.test.ts")
test_text = tests.read_text()
anchor = '''\t\tit("pins browser launch env to the Xvfb display owned by this manager", async () => {\n'''
insert = '''\t\tit("keeps owned Xvfb alive when launch options require a browser relaunch", async () => {\n\t\t\tconst firstContext = createMockContext();\n\t\t\tconst secondContext = createMockContext();\n\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)\n\t\t\t\t.mockResolvedValueOnce(firstContext)\n\t\t\t\t.mockResolvedValueOnce(secondContext);\n\t\t\tconst xvfb = { kill: vi.fn() };\n\t\t\t(manager as any).xvfbProcess = xvfb;\n\t\t\t(manager as any).xvfbDisplay = ":123";\n\n\t\t\tconst profile = createTestProfile();\n\t\t\tawait manager.launch(profile, false, "chromium", { viewport: { width: 800, height: 600 } });\n\t\t\tawait manager.launch(profile, false, "chromium", { viewport: { width: 1024, height: 768 } });\n\n\t\t\texpect(firstContext.close).toHaveBeenCalledTimes(1);\n\t\t\texpect(xvfb.kill).not.toHaveBeenCalled();\n\t\t\texpect((manager as any).xvfbDisplay).toBe(":123");\n\t\t\tconst secondLaunch = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[1][1];\n\t\t\texpect(secondLaunch.env).toEqual(expect.objectContaining({ DISPLAY: ":123" }));\n\n\t\t\tawait manager.close();\n\t\t});\n\n'''
if anchor not in test_text:
    raise SystemExit("launch env test anchor not found")
tests.write_text(test_text.replace(anchor, insert + anchor, 1))
