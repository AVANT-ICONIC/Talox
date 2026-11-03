# Read, act, capture and extract

## Read and observe

Run `node docs/agent-guide/examples.mjs read`.

The fixture harness constructs `new TaloxController(dir, {settings: {...PRESETS.ops, headed:false, safeMode:true, humanStealth:0, fidgetEnabled:false, automaticThinkingEnabled:false, autoHeadedEscalation:false, adaptiveStealthEnabled:false, navigationWaitUntil:'domcontentloaded'}})`, applies the bundled-browser workaround in the [overview](README.md), then calls `await t.launch('lab', 'qa', 'chromium')` and `await t.navigate(url)`. It calls `await t.stop()` in `finally`.

`navigate(url)` returns `TaloxPageState`. `getState('full')` returns the full contract, including nodes, interactive elements, console/network evidence, bugs, timing and optional `failed`. `getState('agent')` gives a compact view suitable for the next LLM decision. `getState('debug')` retains forensic evidence. Prefer compact state in the reasoning loop; collect full/debug only when needed. Node IDs and annotated screenshot refs are observation-local; click using the current CSS selector, not a guessed `@e1` selector.

Failure: an operation returns `state.failed` with `operation` and `reason`. Stop the action chain, inspect that reason and [troubleshoot](troubleshooting.md). A resolved promise alone is not success. Do not use the headed `observe` CLI for an unattended one-shot page read: it waits for a human-driven session to end. Its exact flags are [here](cli-reference.md).

## Click, type and fill forms

Run `node docs/agent-guide/examples.mjs interact` and `node docs/agent-guide/examples.mjs form`.

The action recipe calls `await t.waitForSelector('#save', 3000)`, `await t.findElement('Save', 'button')`, `await t.type('#name', 'Ada')`, then `await t.click('#save')`. `findElement` returns `{selector, boundingBox}` or null. Type and click return state and use Talox's reliability path; safe mode makes owned-fixture interactions deterministic. The form recipe types `'Test User'`, submits once and verifies `document.querySelector('#result').textContent` through `t.evaluate(script)`.

`type` appends; clear an existing field intentionally with the underlying page's locator `fill('')` before typing when replacement is required. This is an escape hatch, not a `fillForm` helper. Check validation messages and the final submitted state. Never blindly repeat a submit whose outcome is uncertain.

Failure: element missing, stale or outside the attention frame. Refresh state, use a current selector, wait for the intended element, or adjust the attention frame only if appropriate. Do not use a DOM click for canvas coordinates or inside a different frame; use the frame/vision path. Do not run human takeover in an unattended fixture test.

## Reuse a profile for a login

Run `node docs/agent-guide/examples.mjs profile`.

The harness opens and stops the same `('persistent', 'qa', 'chromium')` profile twice under the same `dir`, writes a localStorage sentinel on the first pass and asserts it survives the second. This verifies persistence without accessing a real login. Real sessions need a durable base directory rather than the fixture's temporary directory; keep the same profile ID and class. Use a separate directory/ID for each concurrently active browser.

Return: `launch`/`stop` resolve void; subsequent navigation returns state with persisted storage applied. Common failure: `PROFILE_IN_USE` means another context owns the directory. Stop that owner or use a different profile; do not remove a live lock. Do not use a temporary fixture profile when you need tomorrow's login. A real human login can use headed mode and `requestHumanTakeover(reason)`; no credentials belong in guide examples.

## Screenshots and PDFs

Run `node docs/agent-guide/examples.mjs screenshot` and `node docs/agent-guide/examples.mjs pdf`.

`await t.screenshot({path: path.join(dir, 'page.png')})` captures the page; optional `selector` crops an element. The return is `Buffer | string` (the implementation may return a path when writing). `await t.annotatedScreenshot()` returns PNG bytes with numbered element refs; write them with `fs.writeFile`. The recipe checks the PNG header.

For PDF, `await t.getPlaywrightPage().pdf({path: path.join(dir, 'page.pdf'), format:'A4', printBackground:true})` uses the already-launched Chromium page and returns PDF bytes. The recipe checks `%PDF`. Talox has no PDF CLI or `annotatedPdf` method. This public page escape hatch keeps the same session/profile; PDF support is Chromium-specific.

Failure: no active page or navigation error. Launch and check `navigate().failed` before capture. Do not use a screenshot as evidence that a submit succeeded; verify the resulting state too. Do not invoke the default screenshot CLI when you require the bundled-browser guarantee described in the overview. Do not try Chromium PDF printing with Firefox/WebKit.

## Extract data

Run `node docs/agent-guide/examples.mjs scrape`.

`await t.extractTable('#prices')` returns `Array<Record<string,string>>`; the fixture asserts `[{col0:'Plan',col1:'Price'},{col0:'Lab',col1:'0'}]` (this fixture has no `thead`; headers are included as a row). `getPracticalTools(t).extractVisibleStructuredContent()` returns `{url,title,sections:[{heading,summary,selectors}]}` built from up to six named state nodes. It is a compact summary, not a full document extraction. `await getPracticalTools(t).exportMarkdownSnapshot(path.join(dir,'snapshot.md'))` writes normalized visible text and returns the absolute path.

Failure: `Table not found: …` means selector/frame/page mismatch. Re-observe before changing the selector. Do not use the six-section summary when completeness matters; explicitly extract the required fields with `t.evaluate(script)` or table extraction and validate counts. Practical helpers `searchOnSite` and `captureApiResponse` exist in the inventory but their evaluated script strings contain TypeScript syntax in this revision; do not assume those paths run as plain browser JavaScript. No successful recipe relies on them.
