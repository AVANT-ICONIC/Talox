from pathlib import Path

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()
old = '''\t\tif (this.xvfbDisplay) {\n\t\t\t// DISPLAY is process-global, so overlapping managers can change it between\n\t\t\t// Xvfb readiness and Chromium spawn. Pin this browser to the display owned\n\t\t\t// by this manager instead of trusting ambient process.env.DISPLAY.\n\t\t\tlaunchOptions.env = { ...process.env, DISPLAY: this.xvfbDisplay };\n\t\t}\n'''
new = '''\t\tif (this.xvfbDisplay) {\n\t\t\t// DISPLAY is process-global, so overlapping managers can change it between\n\t\t\t// Xvfb readiness and Chromium spawn. Pin this browser to the display owned\n\t\t\t// by this manager. Preserve an explicitly supplied launch environment; only\n\t\t\t// inherit the Talox process environment when the caller did not provide one.\n\t\t\tconst launchEnv = launchOptions.env as NodeJS.ProcessEnv | undefined;\n\t\t\tlaunchOptions.env = { ...(launchEnv ?? process.env), DISPLAY: this.xvfbDisplay };\n\t\t}\n'''
if old not in text:
    raise SystemExit("Xvfb launch env anchor not found")
manager.write_text(text.replace(old, new, 1))

tests = Path("tests/unit/BrowserManager.test.ts")
t = tests.read_text()
anchor = '''\t\tit("pins browser launch env to the Xvfb display owned by this manager", async () => {\n\t\t\tconst mockCtx = createMockContext();\n\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);\n\t\t\t(manager as any).xvfbDisplay = ":123";\n\n\t\t\tawait manager.launch(createTestProfile(), false, "chromium");\n\n\t\t\tconst callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];\n\t\t\texpect(callArgs.env).toEqual(expect.objectContaining({ DISPLAY: ":123" }));\n\t\t});\n'''
addition = anchor + '''\n\t\tit("preserves caller-provided browser env while pinning Xvfb DISPLAY", async () => {\n\t\t\tconst mockCtx = createMockContext();\n\t\t\t(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);\n\t\t\t(manager as any).xvfbDisplay = ":124";\n\n\t\t\tawait manager.launch(createTestProfile(), false, "chromium", {\n\t\t\t\tenv: { TALOX_TEST_ONLY: "kept", PATH: "/restricted" },\n\t\t\t});\n\n\t\t\tconst callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];\n\t\t\texpect(callArgs.env).toEqual({\n\t\t\t\tTALOX_TEST_ONLY: "kept",\n\t\t\t\tPATH: "/restricted",\n\t\t\t\tDISPLAY: ":124",\n\t\t\t});\n\t\t});\n'''
if anchor not in t:
    raise SystemExit("Xvfb launch env regression anchor not found")
tests.write_text(t.replace(anchor, addition, 1))
