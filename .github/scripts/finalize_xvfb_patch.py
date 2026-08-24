from pathlib import Path

manager = Path("src/core/BrowserManager.ts")
text = manager.read_text()
old_doc = '''\t/**
\t * Start Xvfb and set DISPLAY environment variable so subsequent Chromium
\t * launches run in "headed" mode against the virtual framebuffer.
\t *
\t * @throws Error if not on Linux, Xvfb is not installed, or spawn fails
\t */
\tprivate releaseXvfbOwnership('''
new_doc = '''\t/** Release Xvfb state only when the supplied child still owns it. */
\tprivate releaseXvfbOwnership('''
if old_doc not in text:
    raise SystemExit("ownership helper doc anchor not found")
text = text.replace(old_doc, new_doc, 1)
start_anchor = "\n\tasync startXvfb(): Promise<void> {"
start_doc = '''
\t/**
\t * Start Xvfb and set DISPLAY for headed Chromium on a virtual framebuffer.
\t * @throws Error if Linux/Xvfb prerequisites fail or startup is interrupted.
\t */
\tasync startXvfb(): Promise<void> {'''
if start_anchor not in text:
    raise SystemExit("startXvfb anchor not found")
manager.write_text(text.replace(start_anchor, start_doc, 1))

tests = Path("tests/unit/XvfbDisplay.test.ts")
test_text = tests.read_text()
bad = r"toMatch(/^:\\d+$/);"
good = r"toMatch(/^:\d+$/);"
if bad not in test_text:
    raise SystemExit("escaped DISPLAY regex anchor not found")
tests.write_text(test_text.replace(bad, good, 1))
