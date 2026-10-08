# Lightpanda hybrid browser engines

Talox adds isolated background tasks routed between Lightpanda and the existing Chromium runtime. Existing `launch()`, `navigate()`, rendered `TaloxPageState`, screenshots, perception, profiles, overlays, and human takeover keep their Chromium behavior. `runBrowserTask()` is the additive engine-neutral API; it returns the actual engine, value, duration, and any fallback reason. Existing CLI commands and autonomous loops continue to use their persistent Chromium workflows. Adopting routed background tasks in those workflows is deferred; this integration does not automatically move existing CLI or autonomous work to Lightpanda.

## Security and compatibility boundary

**Pinned Lightpanda 1.0.0 does not enforce Content Security Policy.** Its [CDP Page implementation](https://github.com/lightpanda-io/browser/blob/588f6223b9cae8a2406aeef035ed9363a3e404fd/src/server/cdp/domains/page.zig) explicitly documents this limitation. Talox requires the `csp` capability for ordinary tasks, so unknown or third-party content routes to Chromium, including in MACHINE mode. Lightpanda can run a task only when the caller sets `trustedContent: true`, asserting that all executed content is owned or independently controlled and does not depend on CSP. Do not use that assertion to bypass a website's security requirements.

Authentication, rendering, screenshots, visual interaction, and takeover require Chromium. Lightpanda cannot receive persistent Chromium profiles, storage state, or credentials. An authenticated routed task borrows the active Talox Chromium session through a separate page; it requires `launch()` first. Neither a fallback nor an engine-mode change transfers a session to Lightpanda.

Talox's existing policy and explicit approval hook run before a controller task. Tasks requiring request policy enforcement remain on Chromium. Disabling Lightpanda telemetry and core dumps preserves local operation; Talox does not disable TLS verification, CORS, or browser security features to gain compatibility.

## Installation and reproducible pin

The installer downloads only official [lightpanda-io/browser release assets](https://github.com/lightpanda-io/browser/releases/tag/1.0.0). It streams to a private non-executable file, verifies exact size and SHA256, then grants execution permission and installs atomically. Existing cached binaries are verified again; corrupted or unreadable caches error instead of being treated as installed.

Pin: **1.0.0**, published **2026-10-02**, source commit **588f6223b9cae8a2406aeef035ed9363a3e404fd**, GitHub release ID **401714696**. No nightly URL, privileged installer, shell pipeline, or additional npm dependency is used. The macOS Apple Silicon binary was downloaded and its SHA256 verified during this integration; Linux and Intel macOS assets are pinned but require native platform validation.

| Platform | Official asset URL | Asset ID | SHA256 |
| --- | --- | --- | --- |
| macOS arm64 | [lightpanda-aarch64-macos](https://github.com/lightpanda-io/browser/releases/download/1.0.0/lightpanda-aarch64-macos) | 605336160 | `955440053a84754dd64c62f970449a56a2b350cdf43ea5f2e809a73047b8173d` |
| macOS x64 | [lightpanda-x86_64-macos](https://github.com/lightpanda-io/browser/releases/download/1.0.0/lightpanda-x86_64-macos) | 605331526 | `e510299683b37a203912eac0ee00732224b2ef9b07fe58e69c467f5255be45e2` |
| Linux arm64 | [lightpanda-aarch64-linux](https://github.com/lightpanda-io/browser/releases/download/1.0.0/lightpanda-aarch64-linux) | 605340458 | `69791924bcee43b13b224af4c845622c5fe66fdbc1b8143bfaa39ca8f85244f5` |
| Linux x64 | [lightpanda-x86_64-linux](https://github.com/lightpanda-io/browser/releases/download/1.0.0/lightpanda-x86_64-linux) | 605343099 | `aa5a4b8ed53d1e38b3c73f5b2647d0a84a82e6744557f45f9a9c85858aa031c3` |

From a source checkout:

```bash
node scripts/install-lightpanda.mjs
# Default: <checkout>/.apex/cache/lightpanda/1.0.0/lightpanda
```

For a user-managed cache, run the same installer with an explicit directory:

```bash
node scripts/install-lightpanda.mjs --cache-dir "$HOME/.cache/talox/lightpanda"
export TALOX_LIGHTPANDA_PATH="$HOME/.cache/talox/lightpanda/1.0.0/lightpanda"
```

Configuration `browserEngine.lightpanda.executablePath` takes priority over `TALOX_LIGHTPANDA_PATH`. The checkout cache is the fallback location. A missing binary produces `lightpanda not installed` with the installer command. AUTO/MACHINE can recover on Chromium and include `not-installed` in the result; direct `LightpandaEngine` use reports the installation error.

The pinned [upstream installation documentation](https://github.com/lightpanda-io/browser/blob/588f6223b9cae8a2406aeef035ed9363a3e404fd/README.md#install) describes Linux binaries as glibc-linked. Alpine/musl and native Windows are outside this release's support. Talox does not auto-download binaries at runtime.

## Architecture assessment and implementation contract

Repository inspection found one lifecycle owner (`BrowserManager`), Playwright/CDP state collection, persistent profile ownership, controller session management, and a Chrome DevTools Inspect server. There was no interchangeable browser engine abstraction or engine dashboard. The integration adds `src/core/browser/` and an Inspect dashboard using the existing Replay UI styling without rewriting the browser workflow:

| Module | Responsibility |
| --- | --- |
| `types.ts` | Task, capability, result, error, configuration, and telemetry contracts |
| `BrowserRouter.ts` | Deterministic capability/reliability routing, worker limits, bounded queue and deadlines, one safe fallback |
| `BrowserTelemetry.ts` | Per-engine completion/latency/error/fallback counters and explicit resource-read status |
| `ChromiumEngine.ts` | Existing `BrowserManager`, one ephemeral context per task, authenticated active-session pages |
| `LightpandaEngine.ts` and supervision/CDP helpers | Official local binary, version check, direct CDP, active capability checks, independent process per task |
| `ResourceMonitor.ts` | RAM/CPU readings for owned process trees; missing readings remain unread |
| `ChromeLaunchArgs.ts` | Central launch arguments retaining `--use-mock-keychain` and `--password-store=basic` |

Lightpanda supports a CDP subset; Talox uses its existing `ws` dependency directly rather than claiming that it implements a complete Playwright browser. Navigation must produce a usable document; DOM and JavaScript results must pass explicit validity checks. CDP unknown methods, browser exits, invalid DOM, and deadlines have distinct errors. Merely recognizing a method name does not establish visual or Web API compatibility.

Upstream [Target CDP source](https://github.com/lightpanda-io/browser/blob/588f6223b9cae8a2406aeef035ed9363a3e404fd/src/server/cdp/domains/target.zig) limits its browsing-context model. Talox isolates every Lightpanda task in an owned process instead of pretending Chrome-style independent pages are available. The default router allows two Lightpanda workers and one Chromium worker, with a bounded queue of 100 tasks. Shutdown waits for owned tasks/workers. Chromium shutdown supervises only its CDP-reported positive process IDs, checking process identity before escalation; stalled page closes do not block owned-browser supervision. A confirmed Chromium process crash releases its old manager context before relaunch; a disconnected process still running remains an observable cancellation error. Lightpanda crashes affect a worker and the next task starts a fresh process. Reusing a Lightpanda process is deliberately deferred until isolation can be proven.

## API and modes

```ts
import { TaloxController } from 'talox';

const talox = new TaloxController({
  browserEngine: {
    mode: 'auto',
    lightpanda: { executablePath: '/absolute/cache/lightpanda/1.0.0/lightpanda' },
    concurrency: { lightpanda: 2, chromium: 1 },
    maxQueueSize: 100,
    operationTimeoutMs: 30_000,
    recoveryTimeoutMs: 5_000,
    shutdownTimeoutMs: 30_000,
    reliabilityThreshold: 2,
  },
});

try {
  const result = await talox.runBrowserTask({
    url: 'http://127.0.0.1:8080/owned-fixture',
    operation: 'extract',
    trustedContent: true, // Only independently controlled content without a CSP dependency.
  });
  console.log(result.engine, result.value, result.fallback);
  console.log(await talox.refreshBrowserEngineTelemetry());
} finally {
  await talox.stop();
}
```

Supported operation names are `extract`, `query`, `evaluate`, `click`, `fill`, `cookies`, `network`, and `screenshot`. Query/click/fill use `selector`; fill uses `value`; evaluate uses `expression`. `requiredCapabilities` can add explicit requirements. `authenticated: true` requires the active Chromium session. `timeoutMs` overrides the attempt deadline. Cookie operations currently read the isolated session; there is no cookie-write/import API. Click/fill confirmation establishes DOM dispatch, not completion of a remote transaction. Persistent multistep workflows continue to use the existing Chromium controller.

| Mode | Behavior |
| --- | --- |
| AUTO (`auto`, default) | Prefer Lightpanda only when every required capability is supported and host reliability permits it; otherwise Chromium |
| LIGHTPANDA/MACHINE (`machine`) | Prefer Lightpanda, preserving security/capability checks and bounded safe fallback |
| CHROMIUM/HUMAN (`human`) | Chromium for routed tasks; existing headed workflows and human takeover remain available through normal controller APIs |

`talox.setBrowserEngineMode('human')` affects later tasks; unrelated active tasks retain their selected engine. Reliability is consecutive per-host failure memory for this router lifetime, inspectable through reason codes, and is reset by successful Lightpanda execution. It is not a persistent learned compatibility database.

The Inspect server gains a dashboard, styled consistently with the existing Replay UI, with **Browser Engine AUTO / LIGHTPANDA / CHROMIUM** and live engine/worker/queue/RAM/completion/latency/error/fallback telemetry. Configure `inspectServer: { port: 9222, host: '127.0.0.1' }`, then call `await talox.launch('engine-demo', 'qa')` to start the controller's Inspect server before opening `http://127.0.0.1:9222/`. Configuration alone does not start the dashboard; `InspectServer.getDashboardAddress()` returns its URL after attachment. The existing DevTools link remains available. Resource updates poll once a second and display unread values explicitly. `GET /engine` provides JSON; mode changes use `POST /engine/mode` with the dashboard's local same-origin control protection. A mode change affects subsequent routed tasks only.

## Fallback and replay safety

An unsupported essential capability selects Chromium before execution. A Lightpanda failure may cause one Chromium attempt after cancellation is confirmed. Recovery has its own deadline, so an unresponsive worker cannot leave an unbounded retry chain.

Extraction, queries, cookie reads, network inspection, and screenshots are replayable. JavaScript evaluation is replayable only with an explicit truthful `readOnly: true` assertion. Clicks and fills are never automatically replayed after dispatch; unknown errors are considered ambiguous. A possible submission, payment, purchase, delete, or other effect ends with a surfaced `unsafe-replay` error instead of guessing whether it happened. Unsupported actions proven not dispatched can route safely before execution. No cookies or authenticated state are copied during fallback.

Results expose `fallback.from`, `fallback.to`, and detailed reason codes including `unsupported-capability`, `unsupported-command`, `broken-dom`, `engine-crashed`, `operation-timeout`, `not-installed`, and `site-unreliable`. `cancellation-unconfirmed` is a terminal error: Talox cannot safely retry when the previous worker's cancellation remains uncertain. Resource telemetry uses `null` and `unread`/`error` when reading fails; unread inputs never become zero resource usage or success.

## Repeatable measurements

```bash
npm run build
node scripts/benchmark-browser-engines.mjs --runs 3 --concurrency 1,2,4,10
# Consider 25/50 only when the shared host has capacity:
node scripts/benchmark-browser-engines.mjs --runs 3 --concurrency 1,10,25,50 --output .apex/benchmarks/scaling.json
```

The runner serves owned fixtures on a free loopback port, uses identical tasks and correctness checks for both raw adapters, and records distributions in [benchmarks/lightpanda.json](benchmarks/lightpanda.json). Fixtures cover static HTML, microtask-rendered DOM, structured listings, JavaScript computation, local form changes, DOM/history SPA changes, several article URLs, and a synthetic authenticated-cookie workflow. A standalone adapter has no logged-in controller context, so the authenticated workload is explicitly unsupported instead of borrowing an unrelated user session.

Measurements include first/subsequent task latency; startup, navigation-to-DOM, and execution phase callbacks; in-page extraction/JavaScript time where supported; active owned-worker RSS and CPU; concurrency throughput; success, unsupported, and crash counts. Percentiles use nearest rank. RAM sampling is every 50ms, so a brief peak may be missed. The report retains per-attempt timings and correctness failures. Raw adapter measurements do not exercise fallback; fallback frequency is explicitly unread there and is verified by router tests.

Measured on **2026-10-08**, macOS arm64, 10 logical CPUs / 32 GiB RAM, Node 22.23.2: nine supported workloads repeated three times at concurrency one. Both adapters passed **27/27** supported attempts, reported **3** authenticated-context attempts unsupported, and had **0** failed attempts or detected crashes. The standalone adapters do not have an active authenticated controller context.

| Measured metric | Chromium | Lightpanda 1.0.0 |
| --- | ---: | ---: |
| Complete supported task p50 / p95 | 203.01 / 242.18 ms | 179.14 / 250.15 ms |
| Startup phase p50 / p95 | 154.74 / 182.09 ms | 161.90 / 211.09 ms |
| Navigation to usable DOM p50 / p95 | 14.37 / 28.01 ms | 13.65 / 19.35 ms |
| First complete task, one process-cold sample | 874.03 ms | 243.80 ms |
| Subsequent complete task, one sample | 196.75 ms | 142.06 ms |
| In-page extraction p50 / p95, six samples | 0.20 / 0.40 ms | 0.165 / 1.71 ms |
| In-page JavaScript loop p50 / p95, three samples | 1.00 / 1.10 ms | 5.66 / 11.365 ms |
| Sampled peak owned-process RSS | 1,389,084,672 bytes | 33,734,656 bytes |
| Active owned-process CPU snapshot p50 / p95 | 147.3 / 193.7% | 0 / 17.2% |
| Successful supported tasks per second | 4.84 | 5.50 |

These final-adapter measurements show lower median task latency and sampled peak RAM for Lightpanda on these fixtures. Its p95 task latency and JavaScript computation time were higher. CPU values sum an owned process tree and can exceed 100%. Startup distributions include a reused Chromium browser's context creation and fresh Lightpanda processes; the one first-task sample is not a cold-start distribution. Both adapter shutdown calls completed; this records the measured lifecycle and does not establish prolonged absence of orphan processes or memory growth. Steady-state memory and prolonged memory growth remain unread. Shared machine load was **110.0–114.5** and swap did not grow during this run. Concurrency **2/4/10/25/50** was skipped by shared CPU pressure; Chromium 25/50 also exceeded the projected memory reserve. No concurrency-scaling claim is made from this run.

Lightpanda starts a fresh process for every isolated task. Its subsequent task latency is **not** warm process reuse. Chromium reuses its browser with separate contexts. Neither disk caches nor machine load are normalized; first startup is process-cold, and no vendor performance claim is used as evidence. A short local fixture benchmark does not certify production SPA support or prove long-term absence of memory growth.

Scaling checks shared CPU load, available memory, and swap before every batch and at most once a second while scheduling its jobs. It keeps at least 15% of RAM or 2 GiB free plus the prior measured per-worker budget, refuses concurrent scaling above 90% of logical-CPU load, and stops starting jobs when swap grows by more than 64 MiB. Already running jobs settle and owned workers close. Unread pressure or worker RAM blocks scaling beyond one worker; malformed numeric readings error instead of authorizing work. The report records skipped levels and stopped jobs with reasons; 10/25/50 results must remain unclaimed if those gates prevent them.

## Validation and remaining acceptance work

Focused tests cover official installation pins/integrity, unread measurements, fixture server boundaries, adapter lifecycle/CDP/capabilities, router determinism, deadlines/cancellation, non-idempotent replay prevention, queue backpressure, session isolation, policy integration, and Inspect telemetry. Existing Chromium tests are preserved; this feature does not remove or rename any test belief.

Run only explicit test files. The opt-in workflow tests exercise real engines on owned fixtures, AUTO screenshot routing, genuine missing-binary fallback, and an isolated page in an explicitly active Chromium session:

```bash
npm run build
TALOX_ENGINE_INTEGRATION=1 /Users/valunex/.nvm/versions/node/v22.23.2/bin/node --test tests/browser-engine-workflows.test.mjs
/Users/valunex/.nvm/versions/node/v22.23.2/bin/node --test tests/lightpanda-install.test.mjs tests/lightpanda-engine.test.mjs tests/browser-router.test.mjs tests/browser-engine-inspect.test.mjs
node scripts/capture-browser-engine-ui.mjs
# screenshots: .apex/lightpanda-engine-dashboard.png
```

The capture script serves the dashboard on a free worktree-local port and renders it through `ChromiumEngine`, preserving both keychain-safe launch flags. Inspect visual acceptance remains unticked pending operator review of the screenshot.

Remaining acceptance work is explicit: native Linux/Intel execution, representative framework SPA coverage, long-running memory-growth and steady-state measurement, safe cookie-write/import capability review, complex authenticated workflow regression through an active Talox session, larger concurrency batches on an idle host, and deliberate adoption of `runBrowserTask()` by existing CLI/autonomous workflows. Inspect rendered visual sign-off belongs to the operator; screenshots and status are recorded in the delivery fragment. Production security defaults must stay Chromium until upstream CSP and any required request-policy enforcement are verified. Performance claims are limited to the checked-in measured fixture report.
