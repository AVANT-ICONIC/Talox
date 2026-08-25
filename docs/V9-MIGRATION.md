# Migrating to Talox v9

Talox v9 raises the minimum supported Node.js runtime from 18 to 20 and moves page-state collection onto Playwright 1.62's modern ARIA snapshot API.

## Release baseline

The v9.0.0 repository baseline uses Node.js 20+ and Playwright 1.62.1 while keeping the public `TaloxPageState` contract at version 1. `talox doctor` enforces the same Node.js 20 minimum so diagnostics and package metadata agree.

## Required runtime change

Talox v9 requires Node.js 20 or newer.

Before upgrading Talox, verify your runtime:

```bash
node --version
```

If the reported major version is lower than 20, upgrade Node.js before installing Talox v9.

The Node.js floor is the reason this release is a new major version. Talox's public `TaloxPageState` state contract remains version 1.

## Browser runtime

Talox v9 uses Playwright 1.62.1. Projects that pin Playwright separately should align their Playwright, Playwright Core, and Playwright Test versions with Talox to avoid mismatched browser binaries or runtime behavior.

The primary semantic state source is now Playwright's ARIA snapshot API with browser-computed bounding boxes. Talox keeps the legacy accessibility path where available and the DOM collector as a final fallback.

No application change is required for callers consuming the existing `TaloxPageState.nodes` shape. Nodes continue to expose role, accessible name, attributes, trust metadata, and finite viewport-relative bounding boxes.

## Cross-origin iframe behavior

Talox deliberately uses Playwright ARIA snapshot `mode: "default"` rather than `mode: "ai"` for primary page state. Cross-origin iframe content therefore remains governed by Talox's separate trust policy instead of being silently folded into first-party state.

Existing `trustedDomains` and `CrossOriginManager` configuration continue to define which cross-origin frames are reachable.

## Included since v8.1

The v9 release also rolls up the post-v8.1 work already landed on `main`, including:

- MCP stdio server
- community plugin architecture
- offline Replay UI
- cross-origin iframe trust enforcement
- Platform Adapters
- Local VLM integration
- BrowserManager and Xvfb lifecycle hardening
- deterministic profile, selector, and launch error fast paths
- synthetic-document state-collection fast paths
- modern Playwright ARIA state with browser-computed geometry

## Upgrade checklist

1. Upgrade to Node.js 20 or newer.
2. Update Talox to v9.
3. If your project directly depends on Playwright packages, align them with Playwright 1.62.x.
4. Reinstall dependencies and Playwright-managed browser binaries.
5. Run your browser integration tests, especially any code that depends on cross-origin frames or exact page-state semantics.
6. Rebuild Docker images rather than reusing an image layer created with the v8 Node.js runtime baseline.
