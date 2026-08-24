# Talox MCP Server

Talox exposes its local browser runtime as a Model Context Protocol (MCP) server over stdio.

## Start

Build Talox first:

```bash
npm install
npm run build
```

Then start the server:

```bash
node dist/cli/entry.js mcp
```

When Talox is installed as a CLI package, the equivalent command is:

```bash
talox mcp
```

The MCP transport owns `stdout`; diagnostics and Talox logs are kept off the protocol stream.

## Client configuration

Point an MCP client at the built Talox CLI entry with `mcp` as its argument. A generic stdio configuration looks like:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/Talox/dist/cli/entry.js", "mcp"]
}
```

The exact wrapper object around `command` and `args` depends on the MCP client.

## Tools

| Tool | Purpose |
| --- | --- |
| `talox_launch` | Launch one persistent Talox browser session. |
| `talox_navigate` | Navigate the active browser to a URL. |
| `talox_click` | Click an element by selector. |
| `talox_type` | Type text into an element. |
| `talox_state` | Read structured page state. Defaults to the compact `agent` variant. |
| `talox_screenshot` | Capture a page or element screenshot as MCP image content. |
| `talox_stop` | Stop the active browser session and release resources. |

A typical sequence is:

```text
talox_launch
     |
     v
talox_navigate
     |
     +--> talox_state
     +--> talox_click / talox_type
     +--> talox_screenshot
     |
     v
talox_stop
```

The browser session persists across tool calls inside the same MCP server process. `talox_state` intentionally defaults to Talox's `agent` state variant so an MCP client does not pay the context cost of the complete diagnostic state unless it asks for `debug` or `full`.

## Protocol compatibility

The stdio bridge supports the current MCP `2026-07-28` discovery flow and preserves compatibility with handshake-era MCP clients using supported 2024/2025 protocol versions.

For modern clients Talox:

- supports `server/discover`;
- attaches server identity through the modern response metadata envelope;
- supplies deterministic cache hints on the tool catalog;
- returns `resultType: "complete"` for complete results;
- rejects methods removed from the modern protocol rather than silently pretending they still exist.

For legacy clients Talox preserves the `initialize` handshake and legacy server-info response shape.

## Lifecycle and errors

Only one Talox browser session is active per MCP stdio process. Calling `talox_launch` twice without stopping the first session returns a tool error.

Malformed JSON receives a JSON-RPC parse error. Invalid request IDs and unknown RPC methods receive protocol errors. Tool execution failures remain MCP tool results with `isError: true`, allowing the calling agent to inspect and recover from browser-level failures without losing the MCP connection.

The active Talox browser is closed when the MCP input stream ends or the process receives a normal shutdown signal.
