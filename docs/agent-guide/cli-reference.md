# CLI arguments: parser truth

Use the installed `talox` executable, or `node dist/cli/entry.js` in this checkout. All flags below come from the current parsers. Full parser/execution source, conditional requirements and errors live in [capabilities.json](../capabilities.json). This table is a readable snapshot; regenerate the manifest and review this page when changing CLI source.

The executable harness checks each leaf command's help route (`cli-options`), top-level `--help` / `-h`, real `init`, real replay and stdio MCP. Help exits before browser/model startup. No live LLM call is claimed. The `skill` parent requires `create`; `talox launch` is not a command.

## Positional inputs and traps

| Command | Positional input / constraint |
|---|---|
| `observe` | No positional URL; opens a human-driven session and waits for closure |
| `init` | Optional directory; default `talox-app` (see source constant) |
| `screenshot` | Optional URL; absent means capture initial page; writes annotated PNG |
| `chat` | No goal positional; interactive LLM chat; `--url` is API base URL |
| `doctor` | No positional input; diagnostics include network/live-launch checks; `--fix` can install binaries/change config |
| `daemon` | No positional input; long-running local IPC service |
| `run` | Required goal, quoted as one shell argument; `--url` is start page |
| `research` | Required goal and `--domain`; experiments need a model/key |
| `skill create` | Required `--domain`, `--name`, `--description`, `--file`; writes a domain skill |
| `replay` | Optional session directory or `report.json`; absent chooses newest under `./talox-sessions` |
| `mcp` | No extra arguments except `--help`/`-h`; stdio server until EOF/shutdown |

Top-level `--help` and `-h` normalize to `init --help`. Some legacy leaf commands accept only `--help`; do not assume `-h` works everywhere. Most options require separate tokens, not `--flag=value`; the deliberate exception is `--agents=N`. The multi-agent path parses a subset of the run flags and ignores unknown options; misspellings can silently fall back to defaults. Use these exact spellings.

`OPENAI_API_KEY` provides an alternative to `--api-key`. `OPENAI_BASE_URL` is read in chat and multi-agent execution; single-agent run/research pass their parsed base URL instead. Chat parser's model default is `gpt-4o`, so do not assume `OPENAI_MODEL` overrides a nonempty CLI model. Environment behavior is recorded at every read site in the manifest.

## chat

Source: `src/cli/talox.ts:1209`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--model` | `string` | `"gpt-4o"` | no |
| `--api-key` | `string  /  undefined` | `undefined` | no |
| `--url` | `string  /  undefined` | `undefined` | no |
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |

## daemon

Source: `src/cli/talox.ts:1206`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--socket` | `string  /  undefined` | `undefined` | no |
| `--port` | `number  /  undefined` | `undefined` | no |
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |

## doctor

Source: `src/cli/talox.ts:1203`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |
| `--fix` | `boolean` | `false` | no |

## init

Source: `src/cli/talox.ts:1197`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |
| `explicitDir` (positional) | `string  /  undefined` | `null` | no |

## mcp

Source: `src/cli/mcp.ts:6`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |

## observe

Source: `src/cli/talox.ts:1194`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--profile` | `string` | `"observe"` | no |
| `-p` | `string` | `"observe"` | no |
| `--class` | `ProfileClass` | `"ops"` | no |
| `-c` | `ProfileClass` | `"ops"` | no |
| `--browser` | `BrowserType` | `"chromium"` | no |
| `-b` | `BrowserType` | `"chromium"` | no |
| `--output-dir` | `string` | `path.join(process.cwd(), "talox-sessions")` | no |
| `--format` | `"json"  /  "markdown"  /  "both"` | `"both"` | no |
| `--verbosity` | `2  /  3` | `2` | no |
| `--help` | `boolean` | `false` | no |

## replay

Source: `src/cli/replay.ts:30`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |
| `--open` | `boolean` | `false` | no |
| `--output` | `string` | `null` | no |
| `-o` | `string` | `null` | no |
| `inputPath` (positional) | `string` | `null` | no |

## research

Source: `src/cli/talox.ts:1215`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--domain` | `string` | `""` | yes |
| `-d` | `string` | `""` | yes |
| `--url` | `string  /  undefined` | `undefined` | no |
| `--model` | `string` | `"gpt-4o"` | no |
| `--api-key` | `string  /  undefined` | `undefined` | no |
| `--base-url` | `string  /  undefined` | `undefined` | no |
| `--max-iterations` | `number` | `10` | no |
| `--strategy` | `"conservative"  /  "balanced"  /  "aggressive"` | `"balanced"` | no |
| `--skills-dir` | `string  /  undefined` | `undefined` | no |
| `--runs-per-variant` | `number` | `3` | no |
| `--promotion-threshold` | `number` | `1.15` | no |
| `--research-dir` | `string` | `".talox/research"` | no |
| `--enable-cross-domain` | `boolean` | `false` | no |
| `--enable-prompt-evolution` | `boolean` | `false` | no |
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |
| `goal` (positional) | `string` | `null` | yes |

## run

Source: `src/cli/talox.ts:1212`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--url` | `string` | `null` | no |
| `--model` | `string` | `"gpt-4o"` | no |
| `--api-key` | `string` | `null` | no |
| `--base-url` | `string` | `null` | no |
| `--max-iterations` | `number` | `10` | no |
| `--strategy` | `LoopStrategy` | `"balanced"` | no |
| `--skills-dir` | `string` | `null` | no |
| `--agents` | `number` | `1` | no |
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |
| `--agents=` | `number` | `null` | no |
| `agents` (positional) | `number` | `null` | no |
| `goal` (positional) | `string` | `null` | yes |

## screenshot

Source: `src/cli/talox.ts:1200`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--output` | `string` | `"screenshot.png"` | no |
| `-o` | `string` | `"screenshot.png"` | no |
| `--profile` | `string` | `"screenshot"` | no |
| `-p` | `string` | `"screenshot"` | no |
| `--class` | `ProfileClass` | `"ops"` | no |
| `-c` | `ProfileClass` | `"ops"` | no |
| `--browser` | `BrowserType` | `"chromium"` | no |
| `-b` | `BrowserType` | `"chromium"` | no |
| `--help` | `boolean` | `false` | no |
| `url` (positional) | `string  /  undefined` | `null` | no |

## skill create

Source: `src/cli/talox.ts:1220`. Return: console output / process exit status.

| Argument | Type | Default | Required |
|---|---|---|---|
| `--domain` | `string` | `""` | yes |
| `--name` | `string` | `""` | yes |
| `--description` | `string` | `""` | yes |
| `--file` | `string  /  undefined` | `undefined` | yes |
| `--help` | `boolean` | `false` | no |
| `-h` | `boolean` | `false` | no |

`null` denotes an unestablished default. `undefined` and expressions such as `path.join(process.cwd(), …)` are preserved source, not evaluated settings. API-key and goal preconditions are conditional; read the positional table and manifest `requirements` as well as individual flag requiredness.
