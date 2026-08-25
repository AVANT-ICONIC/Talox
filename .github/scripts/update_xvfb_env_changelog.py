from pathlib import Path

path = Path("CHANGELOG.md")
text = path.read_text()
old = '- **BrowserManager/Xvfb lifecycle hardening** — active managers share one process-level `exit`/`SIGINT` listener pair; Xvfb cleanup registers immediately after spawn, stale child events cannot clear replacement state, concurrent displays are reserved and restored through a process-wide stack, each browser launch is pinned to its manager-owned display, and browser configuration relaunches preserve the live Xvfb process.\n'
new = '- **BrowserManager/Xvfb lifecycle hardening** — active managers share one process-level `exit`/`SIGINT` listener pair; Xvfb cleanup registers immediately after spawn, stale child events cannot clear replacement state, concurrent displays are reserved and restored through a process-wide stack, each browser launch is pinned to its manager-owned display without replacing caller-provided environment variables, and browser configuration relaunches preserve the live Xvfb process.\n'
if old not in text:
    raise SystemExit("lifecycle changelog bullet not found")
text = text.replace(old, new, 1)
old = '- 127 unit test files / 1,957 tests expected after BrowserManager/Xvfb lifecycle, overlap, startup-failure, display-pinning, and relaunch regression coverage; definitive CI validates the exact total before merge.\n'
new = '- 127 unit test files / 1,958 tests expected after BrowserManager/Xvfb lifecycle, overlap, startup-failure, display-pinning, caller-environment preservation, and relaunch regression coverage; definitive CI validates the exact total before merge.\n'
if old not in text:
    raise SystemExit("unit test summary not found")
path.write_text(text.replace(old, new, 1))
