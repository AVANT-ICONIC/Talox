from pathlib import Path

path = Path("CHANGELOG.md")
text = path.read_text()
old = '- **BrowserManager process cleanup listeners** — active managers share one process-level `exit` and `SIGINT` listener pair instead of registering two listeners per instance; Xvfb registers immediately after spawn so the readiness window cannot orphan the child on process exit.\n'
new = '- **BrowserManager/Xvfb lifecycle hardening** — active managers share one process-level `exit`/`SIGINT` listener pair; Xvfb cleanup registers immediately after spawn, stale child events cannot clear replacement state, concurrent displays are reserved and restored through a process-wide stack, each browser launch is pinned to its manager-owned display, and browser configuration relaunches preserve the live Xvfb process.\n'
if old not in text:
    raise SystemExit("lifecycle changelog bullet not found")
text = text.replace(old, new, 1)
old = '- 127 unit test files / 1,951 tests passing after Local VLM security coverage and BrowserManager shared-listener regression coverage.\n'
new = '- 127 unit test files / 1,957 tests expected after BrowserManager/Xvfb lifecycle, overlap, startup-failure, display-pinning, and relaunch regression coverage; definitive CI validates the exact total before merge.\n'
if old not in text:
    raise SystemExit("unit test summary not found")
path.write_text(text.replace(old, new, 1))
