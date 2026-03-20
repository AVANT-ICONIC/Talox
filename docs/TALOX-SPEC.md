# TALOX-SPEC.md - Technical Specification

> **v2.0.0** — No more modes. Everything is always on. Human Takeover Layer, verbosity control, and auto headed/headless switching.

## 1. Goal
Talox provides a persistent, stateful browser runtime for AI agents. In v2, there are no execution modes — all capabilities are always enabled. You control behavior through launch options:
- **Verbosity** — Choose how much perception and simulation you want (`debug` is now a verbosity level, not a mode)
- **Headed/Headless** — Auto-switch or manual control for sites with aggressive bot detection
- **Human Takeover** — Pause agent execution and let a human take control, then resume

## 2. v2 Breaking Changes
- **No modes** — `smart`, `speed`, `debug`, `observe` are deprecated. Use launch options instead.
- **Verbosity** — Use `verbosity: 'shallow' | 'medium' | 'full'` instead of mode-based perception
- **Headed control** — Use `headed: true | false | 'auto'` instead of mode selection
- **No AdaptationEngine auto-escalation** — Manual intervention via Human Takeover Layer

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

## 7. Biomechanical Ghost Engine
- **Fitts's Law:** Steps scaled by distance and target width.
- **Quintic Easing:** Natural burst-and-settle acceleration curves.
- **Bezier Pathing:** Non-linear organic trajectories with micro-jitter.
- **Speed Multiplier:** Applied to steps, polling rates, and jitter.
- **Variable Typing Cadence:** Realistic keystroke timing with occasional corrections.
- **Adaptive Density Awareness:** Adjusts behavior based on UI element density.

## 8. Verbosity — Perception Depth Control

In v2, `debug` is no longer a mode — it's a verbosity level that controls how much perception data you receive.

| Verbosity | Perception Depth | Use case |
| :--- | :--- | :--- |
| `shallow` | DOM + basic AX-Tree | CI pipelines, bulk tasks, speed-critical operations |
| `medium` | DOM + AX-Tree + console + network | Standard automation tasks |
| `full` | DOM + AX-Tree + console + network + visual map + bug detection | Development, debugging, complex sites |

```typescript
// Fast CI run
await talox.launch('id', 'sandbox', { verbosity: 'shallow' });

// Standard automation
await talox.launch('id', 'sandbox', { verbosity: 'medium' });

// Full debugging with all perception features
await talox.launch('id', 'qa', { verbosity: 'full' });
```

## 9. Auto Headed/Headless Switching

Talox v2 can automatically switch between headed and headless based on bot detection.

| Headed Option | Behavior |
| :--- | :--- |
| `false` | Always headless (default) |
| `true` | Always headed |
| `'auto'` | Starts headless, switches to headed if bot detection triggers |

```typescript
// Always headless (default for most sites)
await talox.launch('id', 'sandbox', { headed: false });

// Always headed (for Cloudflare, aggressive bot protection)
await talox.launch('id', 'sandbox', { headed: true });
await talox.navigate('https://stackoverflow.com');
await talox.think(4000); // ghost mouse proves human presence

// Auto-switch: starts headless, switches to headed on block
await talox.launch('id', 'sandbox', { headed: 'auto' });
```

The combination of:
- **Headed browser**: Cloudflare checks `window.innerWidth/Height` and GPU context
- **Ghost engine**: biomechanical mouse movements, scrolls, jitter prove human presence
- **Stealth fingerprinting**: UA rotation, WebGL spoofing, canvas noise reduce bot signals

## 10. Human Takeover Layer

The Human Takeover Layer allows AI agents to pause execution and hand control to a human, then resume automatically.

```typescript
// Request human takeover
await talox.requestTakeover('Click the CAPTCHA to continue');

// Agent pauses here until human completes the task
// When human clicks "Resume" in the overlay, agent continues

// Check takeover status
const status = talox.getTakeoverStatus();
// { state: 'active' | 'pending' | 'idle', humanPresent: boolean }
```

**Events:**
- `takeoverRequested` — Agent requested human intervention
- `takeoverStarted` — Human has taken control
- `takeoverEnded` — Human released control, agent resumes

**Use cases:**
- CAPTCHA solving
- 2FA verification
- Complex interactions the agent can't handle
- Debugging failed automations

## 11. Self-Healing Selectors
- **Selector Recovery:** Automatic rebuild when element selectors fail.
- **Fallback Chain:** ID → text → role → position.
- **Learning:** Stores successful selector paths for future use.

## 12. Semantic Mapper
- **Component Mapping:** Logical names to DOM node references.
- **Relationship Graph:** Parent/child/sibling relationships.
- **Content Indexing:** Text-based fast lookup layer.

## 13. Network Mocker
- **Modes:** `record`, `replay`, `mock`, `passthrough`.
- **Recording:** Capture request/response pairs to HAR files.
- **Mocking:** Define custom responses via URL patterns or RegEx.

## 14. AX-Tree Differ
- **Diff Computation:** Minimal delta between AX-Tree snapshots.
- **Change Types:** Added, removed, modified node detection.
- **Semantic Diffs:** Property-level change tracking (label, value, description).

## 15. Ghost Visualizer
- **Trail Overlay:** Canvas-based movement path visualization.
- **Timing Annotations:** Event timestamps on playback.
- **Session Replay:** Record and replay sessions with visualization.

## 16. Policy-as-Code
- **YAML Loading:** `loadPolicy(path)` for YAML policy files.
- **Profile Integration:** Policies applied at profile initialization.
- **Runtime Updates:** Hot-reload policies without restart.

## 17. Behavioral DNA Fingerprinting
- **Typing Cadence:** Inter-key timing distribution unique per profile.
- **Movement Profiles:** Unique trajectory signatures.
- **Session Fingerprints:** Stored behavioral profiles per profile ID.

## 18. Multi-Page Support
- **Page Management:** `switchPage(pageId)`, `openPage(url)`, `closePage(pageId)`.
- **Context Isolation:** Each page maintains independent state within the same browser context.

## 19. Agent-Friendly API
- **LLM Function Schema:** Built-in OpenAI function calling support via `getTaloxTools()`.
- **Tool Definitions:** 14 ready-to-use tools for LLM agents.
- **Event Emitter:** Real-time notifications for `navigation`, `stateChanged`, `consoleError`, `bugDetected`, `takeover*`.

## 20. Semantic Page Description
- **Page Summaries:** `describePage()` generates human-readable page descriptions.
- **Intent State:** `getIntentState()` provides compact page type, primary action, inputs, and errors.
- **Element Discovery:** `findElement()` locates elements by text or accessible name.

## 21. Utility Methods
- **Screenshot:** `screenshot()` captures full page or specific elements.
- **Scroll:** `scrollTo()` smoothly scrolls elements into view.
- **Table Extraction:** `extractTable()` parses table data as JSON.
- **Load State:** `waitForLoadState()` waits for `load`, `domcontentloaded`, or `networkidle`.
- **JavaScript:** `evaluate()` executes scripts in browser context.
- **Direct Access:** `getPlaywrightPage()` exposes raw Playwright page for advanced operations.

## 22. Overlay and Session Recording

Use the `overlay` and `record` options to capture sessions for debugging:

```typescript
// Full: headed browser + overlay + session report
await talox.launch('id', 'qa', {
  headed: true,
  overlay: true,
  record: true
});

// AI-driven: headless + overlay (AI drives via evaluate()) + report
await talox.launch('id', 'qa', {
  overlay: true,
  record: true
});
```

### Annotation Protocol

The overlay exposes `window.__taloxEmit__` as a CDP bridge callable via `talox.evaluate()`:

```typescript
await talox.evaluate(`
  window.__taloxEmit__('annotation:add', {
    interactionIndex: 1,
    labels: ['bug'],
    comment: 'Error message...',
    element: {
      tag: 'button',
      text: 'Submit',
    },
  });
`);
```

**Session end:**

```typescript
await talox.evaluate(`window.__taloxEmit__('session:end', {})`);
```

After `session:end`, `SessionReporter` writes:
- `session-{id}-{timestamp}.json` — machine-readable report
- `session-{id}-{timestamp}.md` — Markdown ready to paste into a PR or issue

The Markdown report includes a timeline of interactions, an annotations table with labels and element references, and a summary of console errors and network failures.

> **Implementation note:** In a persistent browser context, `ctx.pages()[0]` returns the default blank page, not the navigated page. Always use `talox.evaluate()` to target the correct active page. Never use `page.evaluate()` directly in tests.

Observe mode supports AI-driven exploratory testing by exposing `window.__taloxEmit__` as a CDP bridge callable via `talox.evaluate()`.

**Annotation protocol:**

```typescript
await talox.evaluate(`
  window.__taloxEmit__('annotation:add', {
    interactionIndex: 1,         // which step in the interaction timeline
    labels: ['bug'],             // 'bug' | 'note' | 'question' | 'improve'
    comment: 'Error message...',
    element: {
      tag: 'button',
      text: 'Submit',
    },
  });
`);
```

**Session end:**

```typescript
await talox.evaluate(`window.__taloxEmit__('session:end', {})`);
```

After `session:end`, `SessionReporter` writes:
- `session-{id}-{timestamp}.json` — machine-readable report
- `session-{id}-{timestamp}.md` — Markdown ready to paste into a PR or issue

The Markdown report includes a timeline of interactions, an annotations table with labels and element references, and a summary of console errors and network failures.

**Implementation note:** In a persistent browser context, `ctx.pages()[0]` returns the default blank page, not the navigated page. Always use `talox.evaluate()` to target the correct active page. Never use `page.evaluate()` directly in tests.
