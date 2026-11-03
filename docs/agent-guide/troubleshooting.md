# Diagnose the observed failure

Start with `state.failed` after navigation/click/type; those operations catch errors into the state contract. Preserve the failing selector/URL, current state, profile class and operation. Screenshot/report helpers may throw instead. MCP adds tool errors and JSON-RPC errors around the state contract.

These messages were extracted from current throw/tool-error sites (not guessed from README prose). Each link leads to the implementing source; exact line references and the complete direct-throw inventory are also in [capabilities.json](../capabilities.json), top-level `errors`. Browser/OS/network exceptions can add messages beyond that inventory.

| Message / substring | Cause | Fix |
|---|---|---|
| `Policy Violation: URL … not allowed for … profile` | Profile navigation policy refuses this URL | Inspect the policy and target; use an authorized class/policy. Local file fixtures use `qa`. Do not assume `ops` permits every site. [ActionExecutor](../../src/core/controller/ActionExecutor.ts) |
| `Policy Violation: Action 'click' … blocked` / `Action 'type' … blocked` | Action policy refuses target | Review intended action and policy before retrying; changing the selector is not a policy bypass. [ActionExecutor](../../src/core/controller/ActionExecutor.ts) |
| `Human-in-the-Loop blocked risky action` | Risky operation needs human involvement | Arrange authorized takeover in a headed session; stop unattended execution at this boundary. [ActionExecutor](../../src/core/controller/ActionExecutor.ts) |
| `Element '…' not found within attention frame` | Target is outside the current allowed viewport region | Re-observe; adjust/clear frame only when intended. [ActionExecutor](../../src/core/controller/ActionExecutor.ts) |
| `Element not found: …` / `Table not found: …` | Wrong selector, page, frame or timing | Wait for a specific current selector, check active tab/frame, then retry the read. [ActionExecutor](../../src/core/controller/ActionExecutor.ts) |
| `No active page. Use launch() or openPage() first.` | Session not launched or page closed | Launch once before operations; stop only after evidence is collected. [SessionManager](../../src/core/controller/SessionManager.ts) |
| `Invalid page index: …` | Tab index no longer exists | Check page count and select a valid zero-based index. [SessionManager](../../src/core/controller/SessionManager.ts) |
| `Baseline '…' not found and autoSave is false.` | Visual comparison has no baseline | Deliberately create the baseline using `verifyVisual(key,true)` after reviewing the expected page. [SessionManager](../../src/core/controller/SessionManager.ts) |
| `PROFILE_IN_USE: Persistent profile is already active in this process` | Concurrent launches share a persistent directory | Await owner `stop()` or allocate another profile. [BrowserManager](../../src/core/BrowserManager.ts) |
| `LAUNCH_IN_PROGRESS: Browser launch is already in progress for this manager.` | Overlapping launch calls | Await the first launch; use separate managers for independent browsers. [BrowserManager](../../src/core/BrowserManager.ts) |
| `Browser launch failed for … Please ensure Chrome is installed.` | Default adaptive path selected system Chrome | For a bundled-only workflow configure the manager before launch as shown in the overview; install bundled Chromium if absent. [BrowserManager](../../src/core/BrowserManager.ts) |
| `Browser not launched` | Direct manager page operation before launch | Create the browser context first. [BrowserManager](../../src/core/BrowserManager.ts) |
| `Xvfb virtual display is only supported on Linux.` / `Xvfb not found` | Wrong platform or missing display binary | Use headless on macOS; on Linux install/configure Xvfb when a virtual headed display is intended. [BrowserManager](../../src/core/BrowserManager.ts) |
| `No free X display available in the :99-:199 range.` | Virtual display allocation exhausted | Release owned sessions/displays; investigate leaked owners rather than looping launch. [BrowserManager](../../src/core/BrowserManager.ts) |
| `No CDP session for frame: …` | Detached/unsupported/not-yet-attached frame | Refresh session list and use Chromium for CDP. [CrossOriginManager](../../src/core/CrossOriginManager.ts) |
| `Refusing trusted-frame execution` | Frame origin failed the trust gate | Review exact origin and authorized trust configuration. [CrossOriginManager](../../src/core/CrossOriginManager.ts) |
| `Wildcard trusted domains are not supported` / `Opaque origins cannot be trusted` | Trust configuration is too broad or unrepresentable | Supply explicit non-opaque origins; scheme and port matter. [CrossOriginManager](../../src/core/CrossOriginManager.ts) |
| `No active Talox MCP browser session. Call talox_launch first.` | MCP tool before launch | Call `talox_launch` once. [MCP server](../../src/core/mcp/TaloxMcpServer.ts) |
| `A Talox MCP browser session is already active. Stop it before relaunching.` | Duplicate MCP launch | `talox_stop` then launch. [MCP server](../../src/core/mcp/TaloxMcpServer.ts) |
| `Unexpected argument…` / `variant must be one of: agent, debug, full.` | Input does not match tool schema | Use `tools/list` schemas; do not mix MCP and API argument shapes. [MCP server](../../src/core/mcp/TaloxMcpServer.ts) |
| `Unknown Talox tool: …` | Wrong tool name | MCP state is `talox_state`; generic function schema state is `talox_get_state`. [MCP server](../../src/core/mcp/TaloxMcpServer.ts) |
| `No Talox sessions found in …` / `Unknown replay option: …` | Wrong working directory/input or flag | Supply an explicit observe session path and `--output` path. [Replay CLI](../../src/cli/replay.ts) |
| `Invalid Talox session report: …` / `Invalid Talox replay artifact: …` | Wrong/incomplete JSON report or malformed sidecar | Await report flush and use the matching session artifacts. [Replay loader](../../src/core/replay/ReplayLoader.ts) |
| `LLM API error: …` | Planner endpoint returned non-success | Check model, key and compatible base URL; do not repeat browser actions blindly. [Planner](../../src/core/loop/Planner.ts) |
| `Refusing non-loopback local vision endpoint` | Local mode targets another host | Point to the local server or explicitly authorize remote screenshot transfer. [Local vision](../../src/core/LocalVisionReasoner.ts) |
| `Local vision request timed out after …ms.` | Local inference exceeded the configured bound | Check server/model readiness, reduce request size or intentionally adjust timeout. [Local vision](../../src/core/LocalVisionReasoner.ts) |
| `Local vision server returned HTTP …` / `invalid JSON` | Wrong service/API path or bad server response | Verify provider, base URL and server protocol. [Local vision](../../src/core/LocalVisionReasoner.ts) |
| `Duplicate rule id … in plugin.` / `already registered by another plugin` | Registry ID collision | Use unique stable IDs and unregister test plugins. [Plugin registry](../../src/core/plugins/PluginRegistry.ts) |
| `adapter.id must be a lowercase identifier` / `adapter.guidance must contain non-empty strings.` | Invalid custom adapter | Follow `PlatformAdapter` contract; matching adapters contribute guidance only. [Adapter registry](../../src/core/platform/PlatformAdapterRegistry.ts) |

## Symptoms without an exception

A blank screenshot can follow ignored navigation failure. Inspect state before capture; the screenshot CLI now exits nonzero on a returned navigation failure. A correct-looking replay can still contain unsuccessful actions: inspect failures and network/console evidence. A resolved MCP tool call can contain a page state's `failed` object.

`type` appending twice is not self-healing failure: it is append semantics. A tab apparently changing after `openBackgroundTab` is current `openPage` activation behavior. A system-Chrome/Keychain prompt means the bundled-only manager workaround was not applied; controller `adaptiveStealthEnabled:false` alone does not change the manager's separately initialized config in v9.0.1.

If `searchOnSite` or `captureApiResponse` throws a browser JavaScript syntax error, inspect the evaluated strings in [practical-tools.ts](../../src/tools/practical-tools.ts): they contain TypeScript syntax. Prefer the verified table/summary/text paths for this revision; this documentation lane does not modify runtime source.
