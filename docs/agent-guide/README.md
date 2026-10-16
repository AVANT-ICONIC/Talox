# Talox Agent Guide

Talox is a TypeScript browser runtime on Playwright with persistent profiles, structured state contracts, observability, replay, multi-agent runs, MCP server, plugins, adapters, local vision, iframe trust, presets and practical tools.

## Decision table

| I need to | Use |
|---|---|
| read a page and get structured state | `talox observe` or `TaloxController` + `navigate` |
| click and type resiliently | `TaloxController` actions with self-healing selectors |
| fill a form | practical tools `fillForm` via `getPracticalTools(talox)` |
| login with persistent profile | `talox launch <profileId> <profileClass> chromium` then `navigate` |
| screenshot or PDF | `talox screenshot <url> --output <file>` |
| scrape site | `getPracticalTools(talox).searchOnSite` / `extractVisibleStructuredContent` |
| work with iframes | CrossOriginManager + `iframeTrust` preset |
| multi-tab | `getPracticalTools(talox).openBackgroundTab` |
| multi-agent run | `talox run "<goal>" --agents N` |
| replay a failure | `talox replay <session>` |
| local vision | `local-vision` exports `LocalVisionReasoner` |
| MCP server | `talox mcp` |
| plugins / adapters | `plugins.ts` / `adapters.ts` public exports |

## Recipes

### Read a page
```bash
node dist/cli/entry.js init /tmp/lab
```
CLI: `talox observe --profileId observe --profileClass ops --browser chromium`
API: `await talox.launch('observe','ops','chromium'); await talox.navigate(url);`
Returns `TaloxPageState` with title, url, `visibleElements`, `structuredContent`.
Common failure: navigation refused by policy → check `PolicyEngine` and profile class.

### Structured state
Use `PageStateCollector` via `TaloxController.getPageState()`.
Returns JSON schema `TaloxPageState.schema.json`.

### Click and type resiliently
API: `await talox.click(selector)` and `await talox.type(selector, text)`.
Talox uses `SelfHealingSelector` and `HumanMouse` for reliability.
Do NOT use raw Playwright selectors without `TaloxController`.

### Forms
```js
const tools = getPracticalTools(talox);
await tools.fillForm({ selector: '#login', fields: { user, pass } });
```
Returns `{ success, errors }`.

### Logins with persistent profiles
`talox launch profileId profileClass chromium` reuses `ProfileVault`.
Never pass credentials via CLI args; use env vars.

### Screenshots and PDFs
```bash
talox screenshot https://example.com --output out.png
```
Returns annotated PNG with element refs. PDF via `talox.annotatedPdf()`.

### Scraping
```js
const tools = getPracticalTools(talox);
const hits = await tools.searchOnSite('query', 3);
const structured = await tools.extractVisibleStructuredContent();
```
Do NOT use `page.content()` directly; use structured contracts.

### Iframes
Enable `iframeTrust` in settings and use `CrossOriginManager`.
`talox` runs Playwright's Chromium, never user's Chrome → no Keychain prompt.

### Multi-tab and multi-agent
```bash
talox run "collect pricing" --agents 2 --max-iterations 10
```
`AgentCoordinator` manages agents. Use `--agents 1` for single agent.

### Replay and debugging
```bash
talox replay ./talox-sessions/session-2026...
```
Generates `replay.html`. Use for failure diagnosis.

### Local vision
```ts
import { LocalVisionReasoner } from 'talox/local-vision';
```
Works offline with `VisionGate`.

### MCP server
```bash
talox mcp
```
Starts stdio MCP server. Tools listed in `docs/capabilities.json` kind `mcp`.

### Plugins and adapters
```ts
import { loadPlugin } from 'talox/plugins';
import { getPlatformAdapter } from 'talox/adapters';
```
See `docs/capabilities.json` for signatures.

## Features you didn't know

- `PRESETS` for observe, run, research, etc.
- `TaloxDaemon` for IPC control.
- `HarRecorder` for network capture.
- `SiteWarmup` for performance.
- `VideoRecorder` with ghost cursor.
- `SkillLoader` for domain skills.
- `AutonomousLoop` strategies conservative/balanced/aggressive.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Navigation refused` | Policy blocks origin | Use ops profile or adjust `PolicyEngine` |
| `No API key` | Missing OpenAI key | Set `OPENAI_API_KEY` env |
| `Session not found` | Wrong path for replay | Use newest session in `./talox-sessions` |
| Blank screenshot | Navigation failed and was ignored | Check `state.failed` before capture |

## macOS Keychain note

Talox uses Playwright's bundled Chromium with a temp profile. It never launches `/Applications/Google Chrome.app`, so no macOS Keychain dialog appears.

See topic pages in `docs/agent-guide/` and `docs/capabilities.json` for full signatures.
