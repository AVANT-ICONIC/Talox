from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    path.write_text(text.replace(old, new, 1))


replace_once(Path("package.json"), '"node": ">=18.0.0"', '"node": ">=20.0.0"', "package node engine")
replace_once(Path("README.md"), "Node.js-18+-339933", "Node.js-20+-339933", "README node badge")

changelog = Path("CHANGELOG.md")
text = changelog.read_text()
added_anchor = "- **Local VLM integration** — zero-dependency Ollama and OpenAI-compatible local multimodal providers exposed through `talox/local-vision`.\n"
added_line = added_anchor + "- **Modern ARIA page state** — Playwright 1.62 ARIA snapshots with browser-computed bounding boxes are now the primary semantic source for `TaloxPageState.nodes`, with legacy accessibility and DOM collectors retained as compatibility fallbacks.\n"
if added_anchor not in text:
    raise SystemExit("missing changelog added anchor")
text = text.replace(added_anchor, added_line, 1)
fixed_anchor = "\n### Fixed\n"
changed_section = "\n### Changed\n\n- **Node.js runtime baseline** — Talox now requires Node.js 20 or newer, matching Playwright 1.62.1's supported runtime contract. Node.js 18 is no longer advertised as supported.\n\n### Fixed\n"
if fixed_anchor not in text:
    raise SystemExit("missing changelog fixed anchor")
text = text.replace(fixed_anchor, changed_section, 1)
changelog.write_text(text)

Path("docs/MODERN-ARIA-STATE.md").write_text("""# Modern ARIA page state

Talox uses Playwright's modern ARIA snapshot API as the primary semantic source for `TaloxPageState.nodes` when the runtime exposes it.

## Runtime baseline

This path requires Playwright 1.62.1 and Node.js 20 or newer. Talox's package engine now matches that dependency contract instead of advertising Node.js 18 compatibility that the browser runtime can no longer guarantee.

## Collection order

1. `page.ariaSnapshot({ mode: \"default\", boxes: true })`
2. legacy `page.accessibility.snapshot()` when a compatible older driver exposes it
3. Talox's DOM-based fallback when semantic collection is unavailable, errors, or returns too few usable nodes

The public `TaloxNode` contract does not change. Every emitted node still includes role, name, and a finite `{ x, y, width, height }` bounding box.

## Why `mode: \"default\"`

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
""")
