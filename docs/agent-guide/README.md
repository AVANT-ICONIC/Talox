# Talox: choose the browser operation first

Talox is a local, stateful browser runtime for agents. This guide describes the checked-out **v9.0.1** source (not the older v9.0.0 baseline). Start with structured state; escalate to screenshots or vision when the page requires it. Keep one controller alive across actions and always stop it in `finally`.

| I need to… | Choose this operation, with these arguments | Recipe |
|---|---|---|
| Read a page | `await t.navigate(url)` then `await t.getState('agent')` | [Read](browsing.md#read-and-observe) |
| Get the full contract or diagnostics | `t.getState('full')` / `t.getState('debug')` | [State](browsing.md#read-and-observe) |
| Click or type resiliently | `t.click('#save')`, `t.type('#name', 'Ada')`; inspect `failed` | [Actions](browsing.md#click-type-and-fill-forms) |
| Fill a form | Type each field, click submit, verify the resulting state | [Forms](browsing.md#click-type-and-fill-forms) |
| Keep a login | Reuse the same base directory, profile ID and profile class | [Profiles](browsing.md#reuse-a-profile-for-a-login) |
| Capture a screenshot | `t.screenshot({path})` or `t.annotatedScreenshot()` | [Capture](browsing.md#screenshots-and-pdfs) |
| Print a PDF | `t.getPlaywrightPage().pdf({path, format:'A4', printBackground:true})` | [PDF](browsing.md#screenshots-and-pdfs) |
| Scrape a table / page summary | `t.extractTable('#prices')` / `getPracticalTools(t).extractVisibleStructuredContent()` | [Scraping](browsing.md#extract-data) |
| Reach an iframe | `t.getPlaywrightPage().frameLocator('iframe')`; assess cross-origin trust separately | [Frames](orchestration.md#iframes-reachability-and-trust) |
| Open another tab | `t.openPage(url)`, `t.switchPage(0)`, `t.closePage(1)` | [Tabs](orchestration.md#tabs) |
| Run independent browser workers | Separate controllers and profile IDs; fixed actions with `Promise.all` | [Workers](orchestration.md#parallel-browser-workers) |
| Ask an LLM to coordinate workers | CLI `run` with goal, `--agents N`, `--max-iterations N`, model/API configuration | [Planning](orchestration.md#llm-planned-runs) |
| Debug / replay a failure | Record at launch; `replay <session-dir> --output <html>` | [Replay](orchestration.md#record-debug-and-replay) |
| Use a local vision server | `createLocalVisionReasoner({provider:'ollama', model, baseUrl})`; `t.useVision(reasoner)` | [Vision](integrations.md#local-vision) |
| Expose browser tools to an agent | CLI `mcp` over newline-delimited stdio JSON-RPC | [MCP](integrations.md#mcp) |
| Add rules / visual detectors | `registerTaloxPlugin({name, version, rules, visionDetectors})` | [Plugins](integrations.md#plugins-and-platform-adapters) |
| Get platform-specific guidance | `matchPlatformAdapters(url, title)` from `talox/adapters` | [Adapters](integrations.md#plugins-and-platform-adapters) |

## Run the recipes

From this checkout, build with `npm run build`, then run `node docs/agent-guide/examples.mjs`. Select one recipe by appending its name, for example `node docs/agent-guide/examples.mjs form`. The [executable source](examples.mjs) supplies a local `file://` fixture, temporary profiles, assertions, cleanup and exact imports. Every recipe below links to one of these cases; [VERIFIED.md](VERIFIED.md) records actual results and distinguishes protocol fixtures from real inference.

In prose, `t` means the launched controller from that harness, `url` its fixture URL, `dir` its temporary directory. Replace the fixture with your authorized target for real work. In an installed consumer use `import { TaloxController } from 'talox'`; the checkout harness uses `../../dist/index.js` to test exactly the local build.

## Launch without macOS Keychain prompts

The recipes explicitly select **Playwright's bundled Chromium** and create a temporary profile directory. They never select the user's Google Chrome. This avoids the system-Chrome Keychain path.

**The v9.0.1 default is different:** `BrowserManager.buildLaunchOptions()` sets `channel: 'chrome'` when its own `adaptiveStealthEnabled` is true, and `ProfileVault` uses persistent directories. A bare CLI screenshot or MCP launch therefore cannot be promised to avoid system Chrome. Setting controller settings alone does not propagate to the manager's separate configuration in this revision. Before `launch`, the harness uses the exposed internal seam:

```js
// After constructing t, before launch; see examples.mjs controller().
t._session.browserManager.updateConfig({
  browser: { autoDetect: false, preferred: 'chromium', headless: true },
  settings: { adaptiveStealthEnabled: false, virtualDisplay: false },
});
```

This is a version-specific workaround, not a stable top-level controller option. Keep it while this source requires it. Install missing bundled binaries with `npx playwright install chromium`; never change the workspace's shared `node_modules` symlink. On Linux, select an intentional display configuration rather than copying the macOS headless recipe into a headed workflow.

## Know the boundaries

- `launch(profileId, profileClass, browserType, observeOptions?)` returns `Promise<void>`. Navigation, click and type return state; they often **return a `failed` object rather than throw**. Check it before taking the next action.
- The default `ops` policy permits Google, GitHub, `about:blank` and loopback hosts; `file://` fixtures use `qa`. `qa` and `sandbox` have broad default allowlists. Use the profile class your task authorizes.
- `type` appends text. No `fillForm`, `getPageState`, `annotatedPdf`, `talox launch`, or `LocalVisionReasoner` constructor exists on the advertised surface.
- Node.js 20+ is required. LLM planning needs an OpenAI-compatible endpoint/key; ordinary browser API operations do not.

[CLI arguments and defaults](cli-reference.md) · [Unexpected features](features.md) · [Troubleshooting](troubleshooting.md) · [Machine-readable inventory](../capabilities.json) · [Agent skill](../../skills/talox/SKILL.md)

## Inventory and performance contract

Regenerate with `npm run docs:capabilities`. The generator uses the TypeScript AST/checker, resolves exports across all four entrypoints, reads MCP registrations reached by `src/cli/mcp.ts`, CLI parsers/dispatch/help normalization, presets, practical tools, JSON schemas and environment reads. It never imports executable Talox source. `source` is file:line at generation time.

Each entry has `id`, `kind`, `signature`, `arguments`, `returns`, `errors`, `source`, `useWhen` and `derived`. `null` defaults mean **not statically established**, not a promise of runtime null. Expression objects preserve unevaluated source. API member entries include overloads as separate source locations; `apiExports` counts only the public export names. `properties` expands object contracts up to two levels; named return types resolve through the API/schema inventory. Direct throw/tool-error sites are included; transitive browser/network exceptions are not exhaustively inferred.

`derived:false` and `notDerivable` are deliberate review queues: conditional CLI requiredness/positionals, environment-dependent defaults and unevaluated expressions need the linked source. The unit test prints this complete list and independently checks CLI routes/flags, MCP schemas and compiler-resolved exports. Do not turn unknown values into invented documentation.

This documentation adds no browser-runtime work. Generation is a one-shot compiler pass, no network and no polling. Maintenance budgets: generation under 30 s and 512 MiB RSS on a developer machine; unit inventory checks under 60 s each. Recipe waits are bounded (3 s for the fixture selector, 3 s for the local vision fixture, 20 s per CLI child); fixtures have no remote page resources. These are acceptance budgets, not a claim that a real website or model will respond within them.
