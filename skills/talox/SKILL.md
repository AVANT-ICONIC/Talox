---
name: talox
description: >-
  Load whenever about to browse a page, scrape a website, take a screenshot,
  fill a form, print a PDF, or automate a web UI. Use Talox's stateful browser
  runtime for structured observation, resilient actions, persistent profiles,
  tabs, replay, local vision and MCP instead of starting an unrelated browser.
---

# Talox browser operations

Start with the [task guide](../../docs/agent-guide/README.md). This skill targets the checked-out v9.0.1 API. [Capabilities](../../docs/capabilities.json) are generated from source; read the relevant entry before guessing an argument. Preserve the current user's task permissions.

| Task | First choice |
|---|---|
| Read / decide next action | `navigate(url)` → `getState('agent')` |
| Click / fill a form | `type(selector,text)` → `click(selector)` → verify result |
| Persist login | Same base directory + profile ID + class across launches |
| Screenshot / PDF | `screenshot({path})` / current page `.pdf(options)` |
| Table / text extraction | `extractTable(selector)` / practical text helpers |
| Frame / multiple tabs | Frame locator or trust manager / `openPage`, `switchPage` |
| Parallel tasks / model planning | Separate controllers / CLI `run` with `--agents N` |
| Diagnose / replay | `getState('debug')`; record on launch and CLI `replay` |
| Agent host tools | CLI `mcp`; query `tools/list` for exact schemas |
| Local vision / extensions | `talox/local-vision`, `talox/plugins`, `talox/adapters` |

## Ten frequent calls, with exact arguments

These calls are exercised by the [offline recipes](../../docs/agent-guide/examples.mjs). `dir` is an absolute profile/output directory and `url` is the authorized target; the test fixture uses a temporary `file://` page. Import `TaloxController` from `talox` in an installed consumer (the checkout uses `dist/index.js`).

1. Construct: `const t = new TaloxController(dir, {settings:{headed:false,safeMode:true,humanStealth:0,fidgetEnabled:false,automaticThinkingEnabled:false,autoHeadedEscalation:false,adaptiveStealthEnabled:false,navigationWaitUntil:'domcontentloaded'}})`.
2. Launch: `await t.launch('lab', 'qa', 'chromium')` → void. Apply the bundled-browser configuration below **before** this call.
3. Read: `await t.navigate(url)` → full page state; check `state.failed`.
4. Observe cheaply: `await t.getState('agent')` → compact state. `'full'` and `'debug'` are also valid; API default is full.
5. Type: `await t.type('#name', 'Ada')` → state. Appends text; it does not clear a field.
6. Click: `await t.click('#save')` → state; verify the resulting page before repeating an action.
7. Find: `await t.findElement('Save', 'button')` → `{selector,boundingBox}` or null.
8. Capture: `await t.screenshot({path: path.join(dir,'page.png')})` → Buffer or path. `await t.annotatedScreenshot()` returns PNG bytes with current element labels.
9. Extract: `await t.extractTable('#prices')` → records of string cells. See the verified fixture for header-row behavior.
10. Finish: `await t.stop()` → void; always call in `finally`, including when actions fail. Stop flushes recordings.

## Browser selection on macOS

Do not start the Google Chrome binary. The offline guide uses bundled Chromium and temporary profiles, avoiding the system-Chrome Keychain path. **Do not assume Talox's current default has this property:** v9.0.1 manager defaults select `channel:'chrome'` when adaptive stealth is enabled, and manager config is separate from controller settings. Until that runtime seam changes, configure the exposed internal manager before launch:

```js
t._session.browserManager.updateConfig({
  browser: {autoDetect:false, preferred:'chromium', headless:true},
  settings: {adaptiveStealthEnabled:false, virtualDisplay:false},
});
```

This is a version-specific internal workaround. See the [launch explanation](../../docs/agent-guide/README.md#launch-without-macos-keychain-prompts). Persistent production logins need a durable profile directory; temporary fixture profiles intentionally do not survive directory removal.

## Choose the right continuation

- [Read/actions/forms/profiles/capture/scraping](../../docs/agent-guide/browsing.md): API has no `fillForm`, `getPageState` or `annotatedPdf`. PDF uses `await t.getPlaywrightPage().pdf({path:path.join(dir,'page.pdf'),format:'A4',printBackground:true})` on Chromium.
- [Frames/tabs/workers/replay](../../docs/agent-guide/orchestration.md): `openBackgroundTab` currently activates the new tab; profile IDs must be distinct for concurrent browsers. Cross-origin reachability is separate from trust.
- [CLI arguments](../../docs/agent-guide/cli-reference.md): `--profile`, `--class`, `--browser`; no `talox launch` command. `chat --url` is an API base URL; `run --url` is a start page. Planned runs need a goal, API key and bounded iterations.
- [MCP/vision/plugins/adapters](../../docs/agent-guide/integrations.md): MCP has seven tools; its compact state tool is `talox_state`, not the function-schema name `talox_get_state`.
- [Troubleshooting](../../docs/agent-guide/troubleshooting.md): navigation/click/type can resolve with `failed`; a resolved promise is not proof of success. Inspect policy errors rather than swapping selectors to bypass them.
- [Unexpected features](../../docs/agent-guide/features.md) and [source inventory](../../docs/capabilities.json): presets, session snapshots, HAR, video, inspect server, scoped headers, domain skills, research, quality metrics and more.
- [Verification](../../docs/agent-guide/VERIFIED.md): exact offline scope and limitations. `derived:false` manifest entries carry explicit uncertainty; do not invent missing defaults.

Run all local examples with `node docs/agent-guide/examples.mjs` after `npm run build`, or append a case name such as `form`. These do not contact real sites, perform logins or call paid models.
