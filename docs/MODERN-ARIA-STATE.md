# Modern ARIA page state

Talox uses Playwright's modern ARIA snapshot API as the primary semantic source for `TaloxPageState.nodes` when the runtime exposes it.

## Runtime baseline

This path requires Playwright 1.62.1 and Node.js 20 or newer. Talox's package engine now matches that dependency contract instead of advertising Node.js 18 compatibility that the browser runtime can no longer guarantee.

## Collection order

1. `page.ariaSnapshot({ mode: "default", boxes: true })`
2. legacy `page.accessibility.snapshot()` when a compatible older driver exposes it
3. Talox's DOM-based fallback when semantic collection is unavailable, errors, or returns too few usable nodes

The public `TaloxNode` contract does not change. Every emitted node still includes role, name, and a finite `{ x, y, width, height }` bounding box.

## Why `mode: "default"`

Playwright's AI snapshot mode can inline iframe content. Talox deliberately does not use that mode for the primary page-state contract because iframe reachability and trust are governed separately by `CrossOriginManager` with a default-deny policy. The default ARIA mode restores browser-computed semantics without importing iframe subtrees into first-party `nodes` behind that trust boundary.

## YAML mapping

Playwright 1.62 returns the ARIA snapshot as YAML. Talox parses it with its existing `js-yaml` dependency and maps browser annotations into `TaloxNode` fields:

- `[box=x,y,width,height]` becomes `boundingBox`
- role and accessible name become `role` and `name`
- state annotations such as `[disabled]` and `[level=1]` become node attributes
- ARIA directives such as `/placeholder` are retained as attributes when present

Nodes without browser-provided geometry are not emitted into `nodes`, preserving the frozen state contract rather than manufacturing coordinates.

## Compatibility and fallback

The collector capability-detects the modern API. If modern ARIA collection is unavailable, legacy accessibility collection remains supported where exposed. DOM fallback remains the final recovery path and the outer hydration retry logic is unchanged for normal HTTP/HTTPS applications.

A real Chromium regression verifies semantic roles, accessible names, state attributes, finite geometry, and that iframe content is not folded into first-party page nodes in default mode.
