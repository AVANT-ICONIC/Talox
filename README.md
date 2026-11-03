# Talox

Local-first, open-source, stateful browser runtime for AI agents. This checkout is **9.0.1** (Node.js **20+**, Playwright runtime dependency range **^1.62.1**, AGPL-3.0-only).

Talox combines persistent browser profiles, structured page state, human-paced interaction, recovery strategies, observation reports, and human takeover. Reliability and stealth depend on the target site; neither guarantees access or a successful workflow.

## Quick start

For a fresh source checkout, install the dependencies declared in `package.json` and Playwright's Chromium browser and system dependencies. In a worktree with shared `node_modules`, preserve that directory or symlink and use the existing dependencies. The package exposes the `talox` binary; from this repository use the built entrypoint:

```bash
npm run build
node dist/cli/entry.js --help
node dist/cli/entry.js screenshot about:blank --class qa --output /tmp/talox-readme-blank.png
```

Save this next block as `/tmp/talox-readme-example.mjs` and run it from the repository root with `node /tmp/talox-readme-example.mjs`. Repository examples import `dist/index.js`; installed consumers import the same public API from `talox`.

```javascript
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { TaloxController, getTaloxTools, getPracticalTools } =
  await import(pathToFileURL(join(process.cwd(), 'dist/index.js')).href);

const dir = await mkdtemp(join(tmpdir(), 'talox-readme-'));
const fixture = join(dir, 'page.html');
await writeFile(fixture, '<title>Local lab</title><h1>Local lab</h1><label>Name <input id="name"></label><button id="save" onclick="document.title='Saved'">Save</button>');
const talox = new TaloxController(join(dir, 'profiles'), {
  settings: { safeMode: true, autoHeadedEscalation: false },
});
try {
  await talox.launch('local-lab', 'qa', 'chromium', {
    record: true, output: 'both', outputDir: join(dir, 'sessions'),
  });
  talox.on('navigation', event => console.log('Navigated:', event.url));
  const state = await talox.navigate(pathToFileURL(fixture).href);
  if (state.failed) throw new Error(state.failed.reason);
  await talox.type('#name', 'Ada');
  await talox.click('#save');
  const compact = await talox.getState('agent');
  if (compact.title !== 'Saved') throw new Error('Click did not update the page');
  console.log(compact.title, compact.interactiveElements.length);
  console.log('Function tools:', getTaloxTools().length);
  const tools = getPracticalTools(talox);
  console.log('Snapshot:', await tools.exportMarkdownSnapshot(join(dir, 'page.md')));
  await talox.screenshot({ path: join(dir, 'page.png') });
} finally {
  await talox.stop();
}
```

`safeMode` removes simulated input delays and randomness for local testing. Normal defaults include human-paced interaction. `settings.headed` defaults to `false`; headed operation shows the takeover overlay. Enable human takeover explicitly with `humanTakeover: true` or a timeout object. `requestHumanTakeover(reason)` waits until another caller or the overlay resumes the agent, or the configured timeout expires. See [contracts](docs/TALOX-CONTRACTS.md) for signatures and defaults.

## CLI

Commands are `observe`, `init`, `screenshot`, `doctor`, `daemon`, `chat`, `run`, `research`, `skill create`, `mcp`, and `replay`. There is no `state` CLI command; call `getState('agent')` through the Node API or `talox_state` over MCP.

- `observe` starts a headed observation session with annotations and reports.
- `init [directory]` writes a starter to `talox-app` by default, including `src/browser-lab.ts`. The current generated starter has a stale `launch()` call and an unsupported `settings.overlay` property; correct those using the API below before running it. The repository's [browser lab](examples/browser-lab.ts) uses the current signature.
- `screenshot [url]` writes an annotated PNG; failed navigation exits with code 1 and writes no screenshot.
- `doctor [--fix]` checks prerequisites; `--fix` can install missing prerequisites.
- `daemon` serves newline-delimited JSON over a Unix socket, or loopback TCP when `--port` is supplied (TCP is the default on Windows).
- `chat` starts a headed LLM chat session. `run "<goal>"` starts a headless autonomous loop; `--agents N` routes N > 1 to coordinated execution.
- `research "<goal>" --domain <domain>` runs experiments and promotion/rollback logic. Its parsed provider flags are not all forwarded; see the [CLI reference](docs/TALOX-SPEC.md).
- `skill create` requires `--domain`, `--name`, `--description`, and `--file`; it writes a domain skill under the working directory's `skills/`. It does not prompt interactively.
- [MCP](docs/MCP.md) exposes seven browser tools over stdio. [Replay](docs/REPLAY.md) renders persisted sessions offline.

The [technical specification](docs/TALOX-SPEC.md) lists every flag, default, and environment read from source, including differences between CLI help and execution.

## State contract and interaction

`navigate(url)`, `click(selector)`, `type(selector, text)`, `openPage(url)`, and full `getState()` return `TaloxPageState`. Lifecycle methods and utilities have their own return types. Inspect `state.failed` after navigation; a returned object does not by itself mean navigation succeeded.

Full state contains `url`, `title`, `timestamp`, `console`, `network`, `nodes`, `interactiveElements`, and `bugs`. Optional fields include `axTree`, `timing`, `diff`, `profileId`, `domainHints`, `screenshots`, and `failed`. Interactive element IDs are usable selectors. Semantic nodes primarily come from browser-computed ARIA snapshots with geometry, with legacy accessibility and DOM fallbacks.

`getState('agent')` returns `url`, `title`, `timestamp`, `interactiveElements`, `consoleErrors`, and compact bug descriptions, plus sanitizer metadata when enabled. `getState('debug')` returns URL/title/timestamp, nodes, console, network, and bugs. Compact variants omit fields, including `failed`; retain the action's full result when checking failures.

The [TypeScript types](src/types/index.ts) describe current output. The shipped [JSON schema](src/schema/TaloxPageState.schema.json) is a **legacy, incomplete v1 schema**: its optional `mode` enum and built-in-only bug enum do not fully describe current TypeScript output or plugin bug types. See [contract limitations](docs/TALOX-CONTRACTS.md).

Other API operations include `scrollTo(selector, align)`, `extractTable(selector)`, `evaluate(script)`, `findElement(text, role?)`, `describePage()`, `getIntentState()`, `verifyVisual(baselineKey, autoSave)`, numeric page switching, attention frames, challenge resolution, safe mode, and runtime verbosity. Call `stop()` in `finally` to flush recorders and release the persistent profile.

## Profiles, presets, and practical tools

All profile classes use persistent directories at `<baseDir>/<profileId>`; `sandbox` does not automatically delete data. The constructor's default base directory is `.`. Profile classes select policy posture, not a separate perception mode. `qa` and `sandbox` default to unrestricted navigation. `ops` allows Google, GitHub, `about:blank`, and configured loopback host spellings (including their applicable subdomains); it blocks selector names containing delete/remove/destroy for click/type. Arbitrary `file://` fixtures need `qa` or `sandbox`.

`PRESETS` contains `ops`, `qa`, `observe`, `research`, and `login-heavy`. Spread a preset into constructor `settings`. Presets supply settings only; `PRESETS.observe` does not start report recording. [Exact preset overrides](docs/TALOX-CONTRACTS.md) inherit `DEFAULT_SETTINGS`.

`getPracticalTools(talox)` returns five helpers:

| Helper | Result / limitation |
| --- | --- |
| `openBackgroundTab(url)` | `{ state, message }`; actually switches to the newly opened page |
| `captureApiResponse(endpoint, init?)` | `{ status, headers, body }` via page `fetch`; subject to browser origin policy and the current evaluator's syntax limitation |
| `exportMarkdownSnapshot(dest)` | Absolute output path; formats visible body text rather than converting HTML to Markdown; parent directory must exist |
| `searchOnSite(query, limit = 5)` | Local DOM substring matches `{ selector, snippet, tag }[]`, limit clamped to 1–100; no site search request; current evaluator syntax limitation applies |
| `extractVisibleStructuredContent()` | `{ url, title, sections }` from `SemanticMapper.toStructuredContent()` |

The API-capture and search implementations currently include TypeScript annotations inside strings passed to browser evaluation. Ordinary Chromium cannot parse those strings. This docs-only audit records the source defect; the helpers are not advertised as verified working examples.

## Autonomous execution and skills

`AutonomousLoop` takes `(controller, options)` with required `goal` and `planner` configuration; call `run()` without a goal argument. A custom `plannerOverride` supports local deterministic planning. Loop results include `status`, `stopReason`, iterations, cost, and `createdSkills`. Controller events include `loopStarted`, `loopIteration`, `loopSkillCreated`, `loopGoalAchieved`, and `loopStopped`.

`SkillLoader` discovers `SKILL.md` files under `./skills` and `~/.talox/skills` by default. The loop loads hostname-matched context and can ask a planner with `generateSkill()` to produce a reusable skill via `SkillWriter`. Generated skills are heuristics to review, not a guarantee of future success. The research modules add experiments, cross-domain transfer, prompt evolution, regression checks, versioning, and promotion feedback into domain memory.

[Multi-agent coordination](docs/MULTI-AGENT.md) combines isolated controllers, ordered shared-state merges, conflict strategies, and the Plan → Delegate → Observe loop. [Platform adapters](docs/PLATFORM-ADAPTERS.md) contribute guidance for WordPress, WooCommerce, Shopify, GitHub, and Slack without granting trust or executing actions.

## Integrations and observability

`getTaloxTools()` returns **16** function-tool definitions for a host LLM integration. These are distinct from MCP's seven tools and do not launch a session themselves. The host launches Talox, dispatches validated tool calls to the corresponding controller methods, and returns results to its model. Talox does not ship OpenAI or Anthropic SDK dependencies. Any agent that can run Node scripts or speak MCP can use the same runtime.

Reports require explicit launch options `overlay: true` or `record: true` as the fourth argument after the browser name. `observe: true` sets headed posture but alone does not start report recording. Finalized sessions contain `report.json`, `report.html`, `timeline.json`, `annotations.json`, and persisted screenshots. Markdown is written for `markdown` or `both`; event logs, failures, diffs, bugs, and traces are written when corresponding extras are supplied. Session events carry typed payloads directly (no `event.data` wrapper).

Optional configuration supports origin-scoped headers, HAR recording, DevTools inspection, and video recording. `stop()` flushes enabled recorders. Visual reasoning emits `visualQuestion` to the hosting agent before trying a registered fallback. See [local vision](docs/LOCAL-VISION.md), [plugins](docs/PLUGINS.md), [iframe trust](docs/IFRAME-TRUST.md), [Docker](docs/DOCKER.md), and [architecture](docs/TALOX-ARCHITECTURE.md).

The four public entrypoints are `talox`, `talox/plugins`, `talox/adapters`, and `talox/local-vision`. The [audit](docs/DOCS-AUDIT.md) inventories every value and type export, verification command, and remaining documentation gap.

## Development and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md), [testing](CONTRIBUTING-TESTING.md), [security](SECURITY.md), [v9 migration](docs/V9-MIGRATION.md), and [release workflow](docs/RELEASING.md). The [roadmap](docs/TALOX-ROADMAP.md) and historical [v2 proposal](docs/TALOX-V2-SPEC.md) distinguish implemented features from plans.

Talox is licensed under [AGPL-3.0-only](LICENSE). Commercial licensing enquiries: [office@avant-iconic.com](mailto:office@avant-iconic.com).
