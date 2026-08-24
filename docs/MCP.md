# Talox MCP Server

Talox exposes its stateful browser runtime as a native Model Context Protocol (MCP) server over stdio.

## Requirements

- Node.js 20 or newer
- Talox installed locally or available through `npx`
- A Chromium/Chrome installation discoverable by Talox, or Playwright-managed Chromium

Talox uses the MCP TypeScript SDK v2 and `serveStdio`, which supports the current MCP stdio protocol line while retaining compatibility with legacy initialization clients handled by the SDK.

## Start the server

```bash
npx talox mcp
```

Or from a local checkout after building:

```bash
npm run build
npm run mcp
```

`stdout` is reserved exclusively for MCP protocol messages. Talox writes the startup diagnostic to `stderr`.

## MCP host configuration

A typical local MCP host can launch Talox with a command configuration like:

```json
{
  "mcpServers": {
    "talox": {
      "command": "npx",
      "args": ["talox", "mcp"]
    }
  }
}
```

For a checked-out repository:

```json
{
  "mcpServers": {
    "talox": {
      "command": "node",
      "args": ["/absolute/path/to/Talox/dist/cli/entry.js", "mcp"]
    }
  }
}
```

## Tool surface

| Tool | Purpose |
|---|---|
| `launch_session` | Launch a persistent Talox browser session and return a `sessionId` |
| `stop_session` | Stop one session and release its browser resources |
| `list_sessions` | List sessions owned by the current MCP process |
| `health` | Report MCP runtime health and active-session count |
| `navigate` | Navigate an existing session to a URL |
| `click` | Click an element by selector |
| `type` | Type text into an element by selector |
| `get_state` | Return Talox's fused structured page state |
| `screenshot` | Capture a full-page or selector-scoped PNG screenshot |

### Session lifecycle

Call `launch_session` before using browser tools and retain the returned `sessionId`.

Sessions are headless by default. If `profileId` is omitted, Talox generates a profile name from the unique session ID, preventing concurrent sessions from sharing the same Chromium user-data directory. Supply an explicit `profileId` only when you intentionally want a named persistent profile.

All sessions owned by the MCP process are stopped during graceful SIGINT/SIGTERM shutdown.

### Screenshots

Talox's screenshot action always captures PNG. Buffer screenshots are returned as MCP image content (`image/png`) instead of embedding a large base64 payload inside a text block.

## Programmatic API

The MCP runtime is available through the dedicated package subpath:

```ts
import {
  createTaloxMcpServer,
  serveTaloxMcpStdio,
  TaloxMcpRuntime,
} from "talox/mcp";
```

Create a server around an injected runtime:

```ts
import { createTaloxMcpServer, TaloxMcpRuntime } from "talox/mcp";

const runtime = new TaloxMcpRuntime({
  baseDir: "/tmp/talox-mcp-profiles",
});

const server = createTaloxMcpServer(runtime);
```

Or serve stdio directly:

```ts
import { serveTaloxMcpStdio } from "talox/mcp";

const service = serveTaloxMcpStdio();
// Later, if your host owns lifecycle explicitly:
await service.close();
```

## Docker

The official Talox image uses the same CLI entrypoint, so MCP help and routing work inside the container:

```bash
docker run --rm --init talox mcp --help
```

For a real stdio MCP connection, the host must keep stdin/stdout attached. When using the opt-in Chromium sandbox mode, follow `docs/DOCKER.md` and supply the Playwright-version-matched seccomp profile.

## Validation

Talox CI covers MCP at three levels:

1. unit tests for session lifecycle, daemon-dispatch reuse, structured results, image conversion, and CLI routing;
2. a post-build stdio smoke that spawns the real `dist/cli/entry.js mcp`, performs initialization, lists tools, calls `health`, and verifies graceful SIGTERM shutdown;
3. Docker smoke coverage for the packaged `talox mcp --help` command alongside the existing sandboxed Chromium runtime checks.
