from pathlib import Path
path = Path("tests/unit/BrowserManager.test.ts")
text = path.read_text()
old = '''\t\t\tconst profile = createTestProfile();
\t\t\tawait manager.launch(profile, false, "chromium", { viewport: { width: 800, height: 600 } });
\t\t\tawait manager.launch(profile, false, "chromium", { viewport: { width: 1024, height: 768 } });
'''
new = '''\t\t\tconst profile = createTestProfile();
\t\t\tawait manager.launch(profile, false, "chromium", { args: ["--first-launch"] });
\t\t\tawait manager.launch(profile, false, "chromium", { args: ["--replacement-launch"] });
'''
if old not in text:
    raise SystemExit("relaunch regression anchor not found")
path.write_text(text.replace(old, new, 1))
