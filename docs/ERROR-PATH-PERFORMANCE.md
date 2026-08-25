# Deterministic error fast paths

Talox avoids waiting on browser timeouts when a failure is already known to be deterministic.

## Persistent profile contention

A persistent Playwright profile can have only one active in-process owner. A second `BrowserManager` attempting to launch the same `userDataDir` fails immediately with `PROFILE_IN_USE` before browser discovery, Xvfb startup, or Chromium profile-lock waits.

A single `BrowserManager` also rejects an overlapping in-flight `launch()` with `LAUNCH_IN_PROGRESS`. This prevents two concurrent launches on the same manager from racing through the same profile reservation.

Profile ownership is released on failed launch, context teardown, `close()`, `closeAll()`, and process cleanup. Same-profile configuration relaunches retain the reservation until the replacement context owns it.

## Invalid selectors

Selector syntax errors reported by Playwright during interaction preflight are propagated immediately. Valid selectors that are temporarily missing, detached, intercepted, outside the viewport, or affected by a wrong-tab condition retain the normal recovery path.

Direct Playwright click/type waits use `settings.actionTimeoutMs` (default `5000`) so focused test or application configurations can bound these waits without changing unrelated browser timeouts.

## Lifecycle compatibility

These fast paths preserve the BrowserManager/Xvfb lifecycle guarantees on `main`: virtual-display mode participates in the launch hash, disabling it stops owned Xvfb before a replacement launch, and a manager-owned `DISPLAY` is pinned into the browser environment without discarding caller-provided environment variables.
