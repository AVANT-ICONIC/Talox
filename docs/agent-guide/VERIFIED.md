# Executed verification

Verified in this session on 2026-10-16, macOS arm64, Node.js v26.8.2, package v9.0.1, base `02b2281`. Same-agent source review plus real CLI/API execution; no delegated validation. `node_modules` remained the original shared symlink; no dependency installation.

## Offline recipe results: 20/20

Run `npm run build`, then `node docs/agent-guide/examples.mjs` from the checkout. Each named case also runs independently as shown below. Artifacts/profiles are isolated in a printed temporary directory; review or delete that directory after the run. Page targets are a generated `file://` fixture and `about:blank`; there are no live websites or logins. Vision uses a loopback HTTP protocol fixture.

| Case | Exact reproduction command | Verified result | Exit |
|---|---|---|---|
| CLI help | `node docs/agent-guide/examples.mjs cli-help` | Built entrypoint `--help` | 0 |
| Help alias | `node docs/agent-guide/examples.mjs cli-alias` | Built entrypoint `-h` normalization | 0 |
| Scaffold | `node docs/agent-guide/examples.mjs cli-init` | Real `init <temporary-dir>` writes files | 0 |
| CLI options | `node docs/agent-guide/examples.mjs cli-options` | All ten leaf help routes listed below | 0 |
| Read/state | `node docs/agent-guide/examples.mjs read` | Title, nodes and agent/full/debug states | 0 |
| Resilient actions | `node docs/agent-guide/examples.mjs interact` | Wait/find/type/click; result is Ada | 0 |
| Form | `node docs/agent-guide/examples.mjs form` | Submit and verify Test User | 0 |
| Persistent profile | `node docs/agent-guide/examples.mjs profile` | localStorage survives stop/relaunch | 0 |
| PNG | `node docs/agent-guide/examples.mjs screenshot` | Raw file + annotated PNG signature | 0 |
| PDF | `node docs/agent-guide/examples.mjs pdf` | Current Chromium page produces `%PDF` | 0 |
| Scrape | `node docs/agent-guide/examples.mjs scrape` | Exact table records + summary + text file | 0 |
| Frames | `node docs/agent-guide/examples.mjs iframes` | Real local frame click + origin trust decisions | 0 |
| Tabs | `node docs/agent-guide/examples.mjs tabs` | Open, switch, count and close | 0 |
| Parallel browsers | `node docs/agent-guide/examples.mjs parallel` | Two isolated real controllers navigate | 0 |
| Replay | `node docs/agent-guide/examples.mjs replay` | Real recorded click, flushed report, built CLI HTML | 0 |
| Local vision | `node docs/agent-guide/examples.mjs vision` | PNG sent to loopback fixture; response parsed | 0 |
| Plugins | `node docs/agent-guide/examples.mjs plugins` | Register/list/unregister real registry | 0 |
| Adapters | `node docs/agent-guide/examples.mjs adapters` | Pure GitHub URL matching, no request | 0 |
| MCP handlers | `node docs/agent-guide/examples.mjs mcp` | Seven actual handlers, real bundled browser | 0 |
| MCP stdio | `node docs/agent-guide/examples.mjs mcp-stdio` | Built CLI tools/list over stdio; clean EOF | 0 |

The first sweep found the scrape assertion expected header-name keys, while the actual table without `thead` uses `col0`/`col1` and includes the header row. The assertion and explanation were corrected; the scrape case was rerun and exited 0. All other 19 cases exited 0 in the sweep. The table records final verified outcomes, not a claim that the first sweep was entirely green.

The `cli-options` case runs these built-entrypoint argument vectors (each exit 0):

| Arguments after `node dist/cli/entry.js` | Exit |
|---|---|
| `observe --help` | 0 |
| `screenshot --help` | 0 |
| `chat --help` | 0 |
| `doctor --help` | 0 |
| `daemon --help` | 0 |
| `run 'Read title' --agents 2 --max-iterations 1 --help` | 0 |
| `research --help` | 0 |
| `skill create --help` | 0 |
| `mcp --help` | 0 |
| `replay --help` | 0 |

MCP browser execution uses the built session's controller-factory seam to force bundled Chromium. Default stdio launch is not exercised; stdio discovery is. Vision proves transport/PNG wiring, not actual local model inference. LLM-planned run/chat/research, real human takeover/login, live cross-origin CDP and default coordinator launch are outside offline validation. All browser fixture recipes apply the manager-level workaround; none intentionally selects system Chrome.

## Repository validation

- `npm run build`: exit 0.
- `npm run docs:capabilities`: exit 0; deterministic source-generated manifest.
- Targeted Vitest manifest suite: exit 0, 5/5 tests. Checks byte-for-byte freshness, independent CLI route/flag completeness, actual MCP registrations/schemas, compiler-resolved exports, source locations, portable type rendering and the unresolved-entry list.
- Full `npm run test:unit`: exit 1 due to existing doctor timeouts; see baseline comparison below. No runtime source was changed to hide these failures.
- `git diff --check`: exit 0.

The final full lane run at 10:24 reported **200 passing / 2 failing files**, **2,213 passing / 2 failing / 5 skipped tests**, plus the doctor beforeAll hook timeout. Both failing doctor CLI tests reproduced on `02b2281` in a source-only temporary baseline with the same dependency symlink and the unchanged build: `tests/unit/cli/talox.test.ts:92` and `:102` timed out at 30 s (27 other tests passed). A full baseline run then reproduced the separate `tests/unit/cli/doctor.test.ts:156` hook timeout and the `:102` CLI timeout: **199 passing / 2 failing files**, **2,209 passing / 1 failing / 5 skipped tests**. The timeout set varies between runs; all three observed doctor failures exist on the base source. The new five-test manifest suite passes independently.

The generator was measured with `/usr/bin/time -l node scripts/gen-capabilities.mjs --output /tmp/talox-capabilities-timed.json`: 2.54 s wall, 407,584,768 bytes maximum RSS (389 MiB), within the documented 30 s / 512 MiB maintenance budget. It performs no network requests. These timings describe this machine/run, not a universal runtime guarantee.

## Manifest counts and uncertainty

12 CLI dispatch entries (including the `skill` parent), 7 MCP tools, 309 public exports across four package entrypoints, 712 total API entries including public methods/practical functions, 5 settings presets, 10 named environment variables plus one whole-environment read, and 1 JSON schema.

28 entries are explicitly `derived:false`; all remain in the manifest with source/reasons. They are the 12 CLI entries (conditional/positional inference is partial), 10 named environment entries (no single global default), and these six API entries with unevaluated default expressions:

- `adapters:PlatformAdapterRegistry`
- `adapters:PlatformAdapterRegistry.constructor@235`
- `index:AgentCoordinator.setSharedValue@401`
- `index:createVLMCaptchaSolver`
- `index:SessionReporter`
- `index:SessionReporter.constructor@50`

The unit test lists every unresolved ID, and the manifest's `notDerivable` array is the authoritative complete list. No unknown default or transitive exception behavior is presented as a proven fact.
