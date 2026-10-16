# Connect an agent or extend the runtime

## MCP

Run `node docs/agent-guide/examples.mjs mcp-stdio` for the real built stdio server and `node docs/agent-guide/examples.mjs mcp` for all seven real tool handlers using a controller factory configured for bundled Chromium. The latter uses the built internal `TaloxMcpSession` test seam, not an installed package subpath export. The default stdio server factory has the system-Chrome caveat from the [overview](README.md).

An MCP host starts the executable `talox` with the single argument `mcp` in the intended working directory. The transport is **one JSON-RPC object per line**, not HTTP or Content-Length framing. stdout belongs exclusively to MCP responses; diagnostics use stderr. Server shutdown/EOF stops its active browser. The stdio fixture sends `tools/list`, closes stdin and asserts seven registrations and exit 0 without launching a browser.

| Tool | Exact arguments in the browser fixture | Return |
|---|---|---|
| `talox_launch` | `{profileId:'mcp-lab', profileClass:'qa', browser:'chromium'}` | Text JSON `{launched:true,profileId,profileClass,browser}` |
| `talox_navigate` | `{url}` (fixture file URL) | Text JSON page state |
| `talox_type` | `{selector:'#name',text:'MCP'}` | Text JSON page state |
| `talox_click` | `{selector:'#save'}` | Text JSON page state |
| `talox_state` | `{variant:'agent'}` | Text JSON state (default **agent**) |
| `talox_screenshot` | `{selector:'#save'}` | `content:[{type:'image',data:<base64>,mimeType:'image/png'}]` |
| `talox_stop` | `{}` | Text JSON `{stopped:true}`; false if already stopped |

The browser fixture initializes protocol `2025-11-25` with `capabilities:{}` and `clientInfo:{name:'guide',version:'1'}`, lists tools, launches, navigates, types, clicks, collects state, captures PNG and stops. Legacy initialization supports `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. Modern clients use `server/discover` and protocol `2026-07-28` metadata; the server adds complete-result metadata. See registration schemas in [capabilities.json](../capabilities.json) for required fields, enums and `additionalProperties:false`.

Common failure: `No active Talox MCP browser session. Call talox_launch first.` Launch once before actions; stop before relaunching. `isError:true` denotes a tool failure, while malformed/unknown calls can return JSON-RPC errors. Navigation can embed `failed` inside successful text content, so parse and inspect it too. Do not pass API-only parameters such as screenshot `path`: this MCP tool accepts only `selector`. The general `getTaloxTools()` function-calling schemas are a different surface: they use `talox_get_state`, whereas MCP uses `talox_state`.

## Local vision

Run `node docs/agent-guide/examples.mjs vision`.

The fixture starts an HTTP server on an ephemeral loopback port, calls `createLocalVisionReasoner({provider:'ollama',model:'fixture',baseUrl,timeoutMs:3000,maxTokens:64,keepAlive:0,allowRemote:false})`, installs it with `t.useVision(reasoner)`, then calls `await reasoner.analyze(await t.annotatedScreenshot(), 'Read the heading')`. The server verifies it received an image and returns a fixed answer. This verifies the real request/response wiring, **not model inference or answer quality**.

Return: a `VisualReasoner` with `name` and `analyze(Buffer,question):Promise<string|null>`. Empty model responses return null. Ollama defaults to `http://127.0.0.1:11434`, 60 s timeout and no explicit max-token override. `provider:'openai-compatible'` requires `baseUrl` (usually a local `/v1` endpoint), uses optional `apiKey`, and defaults to 300 maximum tokens. Load a real multimodal model in the local server before using a screenshot in production. `t.useVision(null)` removes the per-controller reasoner.

Failure: `Refusing non-loopback local vision endpoint …` means the host is not loopback. Correct the address; enable `allowRemote` only for intentional screenshot transfer. HTTP/invalid-JSON/timeouts are reported explicitly. Do not use local vision when structured DOM state already answers the question, or claim the fixture proves a real model understands a page.

## Plugins and platform adapters

Run `node docs/agent-guide/examples.mjs plugins` and `node docs/agent-guide/examples.mjs adapters`.

The plugin recipe imports `registerTaloxPlugin`, `listTaloxPlugins` and `unregisterTaloxPlugin` from `talox/plugins`. It registers `{name:'guide-lab',version:'1.0.0',rules:[{id:'lab-rule',analyze:()=>[]}]}`, asserts registry membership, then unregisters it. Registration returns `TaloxPluginInfo` (name, version and rule/detector IDs); unregister returns boolean. A real rule's `analyze(state)` returns bugs. Optional `visionDetectors` supply `{id,detect(context)}` and return visual detections. Register before the relevant collection/analysis, keep identifiers unique and clean up in tests.

Failure: duplicate plugin/rule/detector IDs are rejected, and plugin detector failures are isolated into result errors. Do not use a plugin as an unrestricted browser script loader; it supplies rules/detectors, not browser authority.

The adapter recipe imports `matchPlatformAdapters` from `talox/adapters` and calls `matchPlatformAdapters('https://github.com/AVANT-ICONIC/Talox/issues','Issues')`. This is **pure URL matching**, no network request. It returns matches with `adapterId`, name, kind, confidence, guidance and routes. Built-ins cover GitHub, WordPress admin, WooCommerce admin, Shopify admin and Slack; `PlatformAdapterRegistry` supports custom adapters. `getPlatformAdapterContext(url,title?)` returns guidance text.

Failure: a malformed/unsupported URL yields no matches; custom invalid adapters throw validation errors. Treat guidance as hints checked against live state. Do not interpret an adapter match as authentication, a ready-made scraper or an action executor. No `loadPlugin` or `getPlatformAdapter` function is exported.
