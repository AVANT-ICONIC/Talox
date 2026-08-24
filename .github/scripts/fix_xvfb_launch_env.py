from pathlib import Path

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()
anchor = '''\t\tconst launchOptions = this.buildLaunchOptions(extraOptions, actualBrowserType);\n\n\t\t// Compute hash of launch options to detect config changes\n'''
replacement = '''\t\tconst launchOptions = this.buildLaunchOptions(extraOptions, actualBrowserType);\n\t\tif (this.xvfbDisplay) {\n\t\t\t// DISPLAY is process-global, so overlapping managers can change it between\n\t\t\t// Xvfb readiness and Chromium spawn. Pin this browser to the display owned\n\t\t\t// by this manager instead of trusting ambient process.env.DISPLAY.\n\t\t\tlaunchOptions.env = { ...process.env, DISPLAY: this.xvfbDisplay };\n\t\t}\n\n\t\t// Compute hash of launch options to detect config changes\n'''
if anchor not in text:
    raise SystemExit("launch options anchor not found")
manager.write_text(text.replace(anchor, replacement, 1))

tests = Path("tests/unit/BrowserManager.test.ts")
test_text = tests.read_text()
anchor = '''\t\tit("includes expected chromium args", async () => {\n'''
insert = '''\t\tit("pins browser launch env to the Xvfb display owned by this manager", async () => {\n\t\t\tconst mockCtx = createMockContext();\n\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);\n\t\t\t(manager as any).xvfbDisplay = ":123";\n\n\t\t\tawait manager.launch(createTestProfile(), false, "chromium");\n\n\t\t\tconst callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];\n\t\t\texpect(callArgs.env).toEqual(expect.objectContaining({ DISPLAY: ":123" }));\n\t\t});\n\n'''
if anchor not in test_text:
    raise SystemExit("BrowserManager test anchor not found")
tests.write_text(test_text.replace(anchor, insert + anchor, 1))
