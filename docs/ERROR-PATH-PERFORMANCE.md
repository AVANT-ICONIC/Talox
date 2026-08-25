# Deterministic error fast paths

Talox avoids waiting on browser timeouts when a failure is already known to be deterministic.

## Persistent profile contention

A persistent Playwright profile can have only one active in-process owner. A second `BrowserManager` attempting to launch the same `userDataDir` fails immediately with `PROFILE_IN_USE` before browser discovery, Xvfb startup, or Chromium profile-lock waits.

A single `BrowserManager` also rejects an overlapping in-flight `launch()` with `LAUNCH_IN_PROGRESS`. This prevents two concurrent launches on the same manager from racing through the same profile reservation.

Profile ownership is released on failed launch, context teardown, `close()`, `closeAll()`, and process cleanup. Same-profile configuration relaunches retain the reservation until the replacement context owns it.

## Invalid selectors

Selector syntax is validated before full page-state collection. Playwright parser errors therefore fail immediately instead of paying the AX/DOM hydration and retry cost first. Valid selectors that are temporarily missing, detached, intercepted, outside the viewport, or affected by a wrong-tab condition retain the normal recovery path.

Direct Playwright click/type waits use `settings.actionTimeoutMs` (default `5000`) so focused test or application configurations can bound these waits without changing unrelated browser timeouts.

## Explicit browser launches

When a caller explicitly requests a browser such as `chromium`, Talox launches that browser directly. It no longer starts a throwaway detection browser first. Automatic preferred-browser probing remains available when the browser type is omitted.

## Synthetic browser documents

`about:blank` and `about:srcdoc` still receive a complete state-collection pass, including DOM fallback and interactive-element discovery, but they no longer pay repeated accessibility-tree hydration backoff. These browser-synthetic documents have no application navigation lifecycle for Talox to wait on, so repeated empty-tree retries add deterministic latency without producing new state.

Normal HTTP/HTTPS pages keep the existing progressive hydration retry strategy unchanged.

## Playwright accessibility compatibility

Modern Playwright versions no longer expose the legacy `page.accessibility` snapshot surface that Talox historically attempted first. Talox now treats the missing legacy capability as unavailable rather than as a transient empty accessibility tree, so it enters DOM fallback immediately instead of paying accessibility retry/backoff delays that cannot succeed.

This does **not** remove page hydration protection. The outer DOM collection loop remains active for sparse or still-loading web applications. Compatible drivers that still expose a legacy accessibility snapshot continue through the existing AX path.

A real-browser regression runs against the installed Playwright version and verifies that a page without `page.accessibility` produces usable DOM-backed nodes and interactive elements with **zero legacy AX attempts and zero AX backoff delay**.

## Validated impact

On the GitHub Actions Ubuntu browser runner on 2026-08-25, the first deterministic fast-path pass reduced `tests/core/error-paths.test.ts` from **113.28 seconds** to **57.08 seconds** while retaining all 20 tests.

The synthetic-document pass then reduced the same 20-test shard from **57.08 seconds** to **31.71 seconds**, a further **44.4% reduction**. Relative to the original 113.28-second focused baseline, that run was **72.0% faster**. Hosted-runner wall time varies substantially, so these figures are recorded as observed runs rather than guaranteed CI duration.

The Playwright accessibility-capability fix subsequently passed the same **20/20** error-path tests in **36.00 seconds** on a focused real-Chromium validation run while also passing the dedicated real-browser compatibility regression.

Representative test durations after the fast paths remain in the improved range:

- browser crash recovery: about **4.1 s** in the latest focused validation, down from **9.93 s** in the original baseline
- same-profile contention: about **4.6 s**, down from **9.65 s**
- external navigation + `getState()`: about **3.2 s**, down from **14.01 s**

The largest cost removed by the first pass was malformed-selector handling: ten click/type cases had each spent roughly 5.2 seconds collecting sparse-page state before the parser error was surfaced. The synthetic-document pass removed similarly deterministic hydration waits from intentionally blank/srcdoc states. The compatibility pass removes impossible retries against Playwright's removed legacy accessibility API.

## Lifecycle compatibility

These fast paths preserve the BrowserManager/Xvfb lifecycle guarantees on `main`: virtual-display mode participates in the launch hash, disabling it stops owned Xvfb before a replacement launch, and a manager-owned `DISPLAY` is pinned into the browser environment without discarding caller-provided environment variables.
