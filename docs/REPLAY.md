# Talox Replay

Talox Replay turns a persisted observe session into a local, offline visual player. It uses artifacts Talox already records, so replay does not require a live browser, a cloud service, or a second recording format.

## Quick start

Replay the newest session in `./talox-sessions`:

```bash
talox replay --open
```

Replay a specific session directory:

```bash
talox replay ./talox-sessions/session-abc-2026-08-24T20-00-00 --open
```

A `report.json` path works too:

```bash
talox replay ./talox-sessions/session-abc-2026-08-24T20-00-00/report.json
```

By default Talox writes `replay.html` next to the session's existing report and screenshots. Use `--output` / `-o` to choose another destination.

## What the player shows

The replay UI combines the persisted session contract into one inspection surface:

- chronological click, navigation, input, scroll, and right-click timeline,
- before/after screenshot switching,
- interacted-element bounding-box overlay,
- action URL, selector, role, text, and geometry,
- console errors and network failures linked to the interaction,
- Talox bug summaries linked by interaction index,
- replay context from stored diffs and failures,
- scrubber, previous/next stepping, autoplay, and 0.5× to 4× playback,
- keyboard controls: Left/Right to step and Space to play/pause.

If a frame does not contain its own screenshot, the player falls back to the most recent available screenshot while preserving that interaction's structured details.

## Offline by design

`replay.html` contains the session data needed for the UI and references persisted screenshots with relative paths. It has no CDN, analytics, remote JavaScript, or runtime Talox dependency. Copy the session directory and the replay remains usable.

Session values are serialized into the page with HTML/script delimiters neutralized. Screenshot references are restricted to relative paths or legacy embedded PNG data, preventing replay data from becoming an arbitrary local URL loader.

## CLI

```text
Usage:
  talox replay [session-dir | report.json] [--output replay.html] [--open]

Options:
  --output, -o <path>  Write the replay UI to a custom path
  --open               Open the generated replay in the system browser
  --help, -h           Show replay help
```

When no path is supplied, Talox chooses the most recently modified `session-*` directory under `./talox-sessions`.
