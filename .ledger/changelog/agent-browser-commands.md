---
date: 2026-10-16
type: added
scope: cli
title: Add talox pdf, shot and text so agents never launch the installed Chrome
---

Added `talox pdf <file-or-url> <out.pdf> [--size Letter|A4]`, `talox shot <file-or-url> <out.png> [--size WxH] [--scale N] [--full]` and `talox text <file-or-url> [--engine auto|lightpanda|chromium] [--json]` (`src/cli/agent-browser.ts`). Chromium is always Playwright's bundled build launched through `launchServer` with no channel or executable path, a temporary profile, `--use-mock-keychain` and `--password-store=basic`; `assertBundledChromium` refuses anything outside Playwright's browser cache. `text` reads HTTP(S) through Lightpanda when installed and replays a failed read once on Chromium.

On macOS 27 with Chromium 151 a graceful close spins for Playwright's whole 30 s grace on every variant measured, so one-shot commands close with a 250 ms deadline and then kill the server they own. A CLI call went from about 36 s to 3-6 s at load average 650-950.

Benchmark: `scripts/benchmark-agent-commands.mjs`, results in `docs/benchmarks/agent-commands.json` (5 interleaved runs, 5 pages, 0 failures of 50). Lightpanda peaked at 15-50 MB against Chromium's 80-346 MB. The host load average was about 950 on 10 cores, so absolute latencies are inflated. 23 new unit tests cover argument parsing, target resolution, engine selection, fallback and the bundled-Chromium guard.
