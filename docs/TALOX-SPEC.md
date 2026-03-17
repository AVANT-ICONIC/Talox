# TALOX-SPEC.md - Technical Specification

## 1. Goal
Talox provides a persistent, human-like browser controller for AI agents. Two primary modes: **stealth** for anti-bot evasion and **debug** for maximum observability.

## 2. Browser Runtime Manager
- **Driver:** Playwright (`playwright-core`).
- **Connection:** Chrome DevTools Protocol (CDP) via `browserContext.newCDPSession(page)`.
- **Isolation:** Each profile has its own `user-data-dir`.

## 3. Profile Vault
- **Classes:**
  - `ops`: Persistent authenticated sessions, domain-restricted.
  - `qa`: Full perception, visual regression, debugging.
  - `sandbox`: Ephemeral, low-risk experimentation.
- **Persistence:** Metadata stored in `~/.talox/profiles.json`.

## 4. Perception Layer
- **AX-Tree Snapshot:** Minified accessibility tree for token-efficient agent perception.
- **Visual Map:** Bounding boxes for all interactive elements (`a`, `button`, `input`, etc.).
- **Consolidated State:** Merged DOM, Accessibility, Console, and Network data into a single JSON contract.

## 5. Rules Engine
- **Bug Detection:**
  - Overlapping elements (bounding box math).
  - Clipped elements (overflow check).
  - 4xx/5xx network responses.
  - JS exceptions (captured via CDP `Runtime.exceptionThrown`).
  - Invisible CTA (opacity, visibility, pointer-events check).

## 6. Vision Gate
- **Pixelmatch:** 1px precision for literal regression testing.
- **SSIM:** Structural comparison to ignore anti-aliasing noise.
- **OCR (Tesseract.js):** Extract text from screenshots where DOM text is unreliable.
- **Baseline Vault:** Persistent storage in `./.talox/baselines/`.

## 7. Biomechanical Ghost (HumanMouse)
- **Fitts's Law:** Steps scaled by distance and target width.
- **Quintic Easing:** Natural burst-and-settle acceleration curves.
- **Bezier Pathing:** Non-linear organic trajectories with micro-jitter.
- **Speed Multiplier:** Applied to steps, polling rates, and jitter.
- **Typo Simulation:** Realistic keystroke errors with backspace corrections.
- **Adaptive Stealth:** Adjusts behavior based on UI element density.

## 8. Mode Presets

| Mode | mouseSpeed | humanStealth | adaptiveStealth | typoProbability |
| :--- | :--- | :--- | :--- | :--- |
| `stealth` | 0.7 | 1.0 | enabled | 0.10 |
| `debug` | 1.0 | 0.5 | disabled | 0.05 |
| `balanced` | 1.0 | 0.5 | enabled | 0.08 |
| `browse` | 1.0 | 0.5 | enabled | 0.08 |
| `speed` | 3.0 | 0.0 | disabled | 0.00 |
| `qa` | 1.5 | 0.2 | disabled | 0.00 |

## 9. Self-Healing Selectors
- **Selector Recovery:** Automatic rebuild when element selectors fail.
- **Fallback Chain:** ID → text → role → position.
- **Learning:** Stores successful selector paths for future use.

## 10. Semantic Mapper
- **Component Mapping:** Logical names to DOM node references.
- **Relationship Graph:** Parent/child/sibling relationships.
- **Content Indexing:** Text-based fast lookup layer.

## 11. Network Mocker
- **Modes:** `record`, `replay`, `mock`, `passthrough`.
- **Recording:** Capture request/response pairs to HAR files.
- **Mocking:** Define custom responses via URL patterns or RegEx.

## 12. AX-Tree Differ
- **Diff Computation:** Minimal delta between AX-Tree snapshots.
- **Change Types:** Added, removed, modified node detection.
- **Semantic Diffs:** Property-level change tracking (label, value, description).

## 13. Ghost Visualizer
- **Trail Overlay:** Canvas-based movement path visualization.
- **Timing Annotations:** Event timestamps on playback.
- **Session Replay:** Record and replay sessions with visualization.

## 14. Policy-as-Code
- **YAML Loading:** `loadPolicy(path)` for YAML policy files.
- **Profile Integration:** Policies applied at profile initialization.
- **Runtime Updates:** Hot-reload policies without restart.

## 15. Behavioral DNA Fingerprinting
- **Typing Cadence:** Inter-key timing distribution unique per profile.
- **Movement Profiles:** Unique trajectory signatures.
- **Session Fingerprints:** Stored behavioral profiles per profile ID.

## 16. Multi-Page Support
- **Page Management:** `switchPage(pageId)`, `openPage(url)`, `closePage(pageId)`.
- **Context Isolation:** Each page maintains independent state within the same browser context.
