<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=250&color=0:000000,40:0f172a,75:0f766e,100:0d9488&text=TALOX&fontColor=ffffff&fontSize=72&fontAlignY=35&desc=by%20AVANT%20ICONIC&descSize=15&descAlignY=52&animation=scaleIn" alt="Talox header" width="100%" />

<br />

<img src="./talox.webp" alt="Talox logo" width="72" />

<br />

<img src="https://readme-typing-svg.demolab.com?font=Inter&weight=600&size=22&pause=1200&color=2DD4BF&center=true&vCenter=true&width=980&lines=Stateful+browser+runtime+for+AI+agents.;Persistent+profiles.+Deep+observability.+Structured+state+contracts.;Resilient+interaction+for+real-world+web+UIs." alt="Typing SVG" />

<br />
<br />

<p align="center">
  <a href="#overview"><img src="https://img.shields.io/badge/overview-0f172a?style=for-the-badge&logo=readme&logoColor=white" alt="Overview" /></a>
  <a href="#modes"><img src="https://img.shields.io/badge/modes-0f766e?style=for-the-badge&logo=sparkles&logoColor=white" alt="Modes" /></a>
  <a href="#architecture"><img src="https://img.shields.io/badge/architecture-0d9488?style=for-the-badge&logo=gitbook&logoColor=white" alt="Architecture" /></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/quick%20start-134e4a?style=for-the-badge&logo=rocket&logoColor=white" alt="Quick Start" /></a>
  <a href="#contributing"><img src="https://img.shields.io/badge/contributing-115e59?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Contributing" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Playwright-Chromium-45ba4b?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-0d9488?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="AGPL-3.0-only" />
  <img src="https://img.shields.io/badge/version-1.3.0-0d9488?style=flat-square" alt="version" />
</p>

<p align="center">
  <strong>Talox</strong> is a stateful browser runtime for AI agents, built on Playwright.<br />
  Persistent profiles. Deep observability. Structured state contracts. Resilient interaction for real-world web UIs.
</p>

<p align="center">
  <a href="./docs/TALOX-SPEC.md">Spec</a>
  ·
  <a href="./docs/TALOX-ARCHITECTURE.md">Architecture</a>
  ·
  <a href="./docs/TALOX-ROADMAP.md">Roadmap</a>
  ·
  <a href="./docs/HARBOR-BOUNDARY.md">Harbor Boundary</a>
  ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

</div>

---

## Overview

Talox gives AI agents a persistent, human-paced browser with four execution modes — including a new **observe mode** for human-driven test sessions where the agent captures full context automatically.

Every mode returns the same structured JSON contract: AX-Tree, DOM state, console output, network events, and visual diffs — ready for any agent to consume.

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

// Agent mode — smart self-healing with biomechanical simulation
await talox.launch('my-agent', 'ops', 'smart');
const state = await talox.navigate('https://example.com');

talox.on('adapted', (e) => console.log(`Smart mode adjusted: ${e.reason} → ${e.strategy}`));

await talox.stop();
```

```typescript
// Observe mode — human drives, agent watches
talox.on('sessionEnd', (e) => {
  console.log(`Report: ${e.reportPath}`)
  console.log(`${e.interactionCount} interactions, ${e.annotationCount} annotations`)
})

await talox.launch('human-session', 'ops', 'observe', 'chromium', {
  output: 'both',  // generates JSON + Markdown report
})

// Browser opens. Right-click for Comment Mode. Close browser when done.
```

---

## Key Capabilities

- **Persistent browser profiles** — each agent gets its own isolated browser context with session continuity across runs
- **Structured state contract** — every action returns a single JSON object: AX-Tree, interactive elements, console, network, bugs, screenshots
- **Deep observability** — full AX-Tree snapshots, console capture, network failure tracking, layout bug detection, visual regression
- **Resilient interaction** — human-paced timing, self-healing selectors, semantic element resolution
- **Session replay** — GhostVisualizer overlays interaction paths on screenshots for debugging
- **Policy-as-code** — YAML-based action restrictions per profile
- **LLM-native API** — 14 function-calling tools compatible with OpenAI, Claude, and other LLM APIs

---

## Modes

Talox has four canonical execution modes. Legacy mode strings (`adaptive`, `balanced`, `browse`, `qa`, `stealth`) continue to work with a deprecation warning and map to `smart`.

| Mode | Purpose | Who uses it | When to use |
| :--- | :--- | :--- | :--- |
| `smart` | Self-healing production agent | AI agents | Third-party / bot-protected sites |
| `speed` | Raw Playwright, max throughput | CI pipelines, bulk tasks | Maximum performance, bulk operations |
| `debug` | Full dev mode — bug detection, optional overlay + recording | Testing your own app · AI testing · Human sessions | **Your own web app or site** |
| `observe` | Alias for `debug` + `{ headed, overlay, record }` | Human test runs | Shorthand for human-visible sessions |

### Quick mode selection

> **Getting blocked or seeing bot-detection / CAPTCHA?** → use `smart`
> **Testing or debugging your own app?** → use `debug`
> **Running a fast pipeline task?** → use `speed`
> **Human-visible session with overlay + report?** → use `observe` (or `debug` + `{ headed: true, overlay: true, record: true }`)

The most commonly confused choice: `smart` vs `debug`. If you **own the server**, use `debug` — `smart` adds stealth delays and randomness that distort your results. `debug` gives you clean, deterministic execution with full bug events.

### `smart` mode

The default for production agents. Runs the **Biomechanical Ghost Engine** and adds a self-healing outcome loop:

- After every interaction, `AdaptationEngine` scans the page for bot-detection signals
- Automatically applies named strategies (`stealth_nudge`, `stealth_escalation`, `pace_reduction`, etc.)
- Emits `adapted` events so the agent has full transparency without being blocked

### `debug` mode — the unified developer mode

**Use this mode when testing your own web app or site.** No stealth noise, no warmup delays — clean, deterministic execution with optional overlay and session recording.

`debug` is the super-mode for everything you own. It replaces the old need to choose between `debug` and `observe` for your own app.

```typescript
// Headless AI testing — full bug detection, no browser window
await talox.launch('ai-test', 'qa', 'debug');

// Watch the browser while testing (headed, no overlay)
await talox.launch('watch', 'qa', 'debug', 'chromium', { headed: true });

// AI-driven observe: headless, overlay driven via evaluate(), session report
await talox.launch('ai-observe', 'qa', 'debug', 'chromium', {
  overlay:   true,   // enables right-click context menu + annotation modal
  record:    true,   // writes session report on stop()
  output:    'both',
  outputDir: './sessions',
});
```

Capabilities when `overlay: true`:
- Right-click context menu with Comment Mode, Snapshot, End Session
- Element inspector (hover highlight + blue outline)
- Annotation modal with tag chips (Bug, Note, Question, Improve) + comment
- Ctrl/Cmd+Z undo last annotation
- Session report in JSON + Markdown on session end

Events always emitted in `debug` mode:
- `bugDetected` — layout overlap, clipped elements, invisible CTAs
- `consoleError` — all JS console errors
- `networkError` — failed requests, 4xx/5xx responses

### `observe` mode — shorthand for `debug` + headed + overlay + recording

`observe` is now an alias for `debug` with `{ headed: true, overlay: true, record: true }`. These two are equivalent:

```typescript
// Old: observe alias (still works, no breaking change)
await talox.launch('test-run', 'qa', 'observe', 'chromium', { output: 'both' });

// New: explicit debug flags (same result)
await talox.launch('test-run', 'qa', 'debug', 'chromium', {
  headed: true, overlay: true, record: true, output: 'both',
});
```

The `observe` mode string continues to work exactly as before — it just resolves internally to `debug` + those defaults. No migration needed.

### `speed` mode

Raw Playwright, zero simulation, maximum throughput. No human-like delays, no HumanMouse, no self-healing.

---

## The Smart Interaction Engine

Smart mode runs the **Biomechanical Ghost Engine** — a mouse and keyboard system that produces human-paced, low-noise interaction patterns suited for fragile or complex real-world interfaces.

- **Fitts's Law** — movement speed scales naturally with target size and distance
- **Quintic Easing** — natural burst-and-settle acceleration curves
- **Bezier Pathing** — non-linear, organic trajectories with micro-jitter
- **Physical Press Logic** — clicks include micro-drags and variable duration
- **Variable Typing Cadence** — realistic keystroke timing with occasional corrections
- **Adaptive Density Awareness** — adjusts behavior based on UI element density
- **Behavioral DNA** — unique per-profile interaction fingerprint for session consistency

This makes Talox significantly more reliable on real-world UIs that are sensitive to interaction timing, rapid-fire events, or non-human input patterns.

---

## Debug Mode

Debug mode maximizes what the agent can see without interfering with it.

- Full AX-Tree snapshot as agent-readable JSON
- All interactive elements with bounding boxes
- Console errors, warnings, and logs
- Network failures and 4xx/5xx responses
- Layout bug detection: overlaps, clipped elements, invisible CTAs
- Visual regression via Pixelmatch + SSIM
- OCR text extraction from screenshots (Tesseract.js)
- AX-Tree structural diffing between states
- GhostVisualizer: overlays interaction paths on screenshots for replay

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                      TaloxController                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ BrowserManager│  │  HumanMouse  │  │ PageStateCollector │ │
│  │  (Playwright) │  │  Interaction │  │  AX-Tree + DOM     │ │
│  └──────────────┘  └──────────────┘  └────────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │  VisionGate  │  │  RulesEngine │  │   PolicyEngine     │ │
│  │  SSIM + OCR  │  │  Bug detect  │  │   YAML policies    │ │
│  └──────────────┘  └──────────────┘  └────────────────────┘ │
│  ┌──────────────┐  ┌──────────────────────────────────────┐  │
│  │  TaloxTools  │  │         EventEmitter                │  │
│  │  LLM Schema  │  │   (navigation, errors, bugs)        │  │
│  └──────────────┘  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
       SemanticMapper  AXTreeDiffer  GhostVisualizer
       SelfHealing     NetworkMocker  ArtifactBuilder
       Selector
```

As of v1.2.0, `TaloxController` is a thin orchestrator delegating to `EventBus`, `ModeManager`, `ActionExecutor`, and `SessionManager`. See `docs/TALOX-ARCHITECTURE.md` for the full module map.

| Module | Role |
| :--- | :--- |
| `TaloxController` | Main orchestration API, mode/preset manager |
| `BrowserManager` | Playwright/Chromium lifecycle, persistent profiles |
| `HumanMouse` | Biomechanical Ghost Engine |
| `PageStateCollector` | AX-Tree + DOM harvester → agent-ready JSON |
| `VisionGate` | Visual verification: SSIM, Pixelmatch, OCR, baseline vault |
| `RulesEngine` | Layout bug detection via bounding box analysis |
| `SemanticMapper` | Maps AX-Tree to semantic entities for intent-based interaction |
| `SelfHealingSelector` | Auto-rebuilds selectors when DOM changes |
| `NetworkMocker` | Record / replay / mock network traffic |
| `AXTreeDiffer` | Structural diff between AX-Tree snapshots |
| `GhostVisualizer` | Interaction path overlay for session replay and debugging |
| `PolicyEngine` | YAML-based action restrictions per profile |
| `TaloxTools` | LLM function calling schema for AI agents |
| `EventEmitter` | Real-time notifications for navigation, errors, bugs |

---

## Structured State Contract

Every `navigate()` and `getState()` call returns a `TaloxPageState` — a single JSON object your agent can consume directly without parsing HTML or interpreting screenshots.

```typescript
{
  url: string;
  title: string;
  timestamp: string;
  mode: TaloxMode;

  console: {
    errors: string[];
    warnings?: string[];
    logs?: string[];
  };

  network: {
    failedRequests: Array<{ url: string; status: number }>;
  };

  axTree?: TaloxNode;          // full AX-Tree root
  nodes: TaloxNode[];          // flat list of all AX nodes
  interactiveElements: Array<{ // buttons, inputs, links with bounding boxes
    id: string;
    tagName: string;
    role?: string;
    text?: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    isActionable?: boolean;
  }>;

  bugs: TaloxBug[];            // detected layout/JS/network issues
  screenshots?: { fullPage?: string };
}
```

JSON Schema: [`src/schema/TaloxPageState.schema.json`](./src/schema/TaloxPageState.schema.json)

---

## Agent-Friendly API

### LLM Function Schema

```typescript
import { getTaloxTools, TaloxController } from 'talox';

const tools = getTaloxTools();
// Returns 14 tool definitions: navigate, click, type, get_state,
// describe_page, get_intent_state, screenshot, scroll_to,
// extract_table, wait_for_load_state, set_mode, verify_visual,
// find_element, evaluate
```

### Semantic Page Understanding

```typescript
// Human-readable page description
const description = await talox.describePage();
// "Page: 'Example Domain' at https://example.com. Input fields: search. Buttons: Submit..."

// Compact intent state for quick decision making
const intent = await talox.getIntentState();
// { pageType: 'search', primaryAction: {...}, inputs: [...], errors: [], bugs: [...] }
```

### Event-Driven Workflows

```typescript
talox.on('navigation', (event) => console.log('Navigated to:', event.data.url));
talox.on('consoleError', (event) => console.log('Error:', event.data.error));
talox.on('bugDetected', (event) => console.log('Bug:', event.data));
```

### Utility Methods

```typescript
await talox.screenshot();
await talox.screenshot({ selector: '#hero', path: 'hero.png' });
await talox.scrollTo('#footer', 'center');
const rows = await talox.extractTable('table.product-list');
const title = await talox.evaluate(() => document.title);
const element = await talox.findElement('Submit', 'button');
```

---

## Profile Classes

| Class | Use Case |
| :--- | :--- |
| `ops` | Persistent authenticated sessions, restricted to domain allowlists |
| `qa` | Full perception, visual regression, debugging |
| `sandbox` | Ephemeral, low-risk experimentation |

---

## VPS / Headless Server Setup

Playwright's Chromium requires system dependencies that aren't present on a bare Linux VPS. Run this once after install:

```bash
npx playwright install chromium --with-deps
```

Talox defaults to `headless: true`, so no display server is needed. The required Chromium flags (`--no-sandbox`, `--disable-dev-shm-usage`) are set automatically.

All features work fully headless — including screenshots, visual diff (Pixelmatch/SSIM), OCR (Tesseract.js), and GhostVisualizer. None of these require a display; they operate on pixel buffers and pure JS.

If you're on a low-memory VPS (< 1GB), set `PLAYWRIGHT_CHROMIUM_SANDBOX=0` as an environment variable as well.

---

## Quick Start

```bash
npm install talox
```

Or from source:

```bash
git clone https://github.com/AVANT-ICONIC/Talox.git
cd Talox
npm install   # automatically builds dist/
```

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

// Adaptive mode — resilient, human-paced interaction
await talox.launch('agent-1', 'ops', 'adaptive');
const state = await talox.navigate('https://example.com');
console.log(state.axTree);

// Switch to debug for analysis
await talox.setMode('debug');
const debugState = await talox.getState();
console.log(debugState.bugs);

await talox.stop();
```

---

## Observe-Driven Testing

Talox observe mode enables a test pattern that doesn't exist in any other framework: **AI-driven exploratory testing with structured, element-attached annotations**.

Instead of scripting every assertion in advance, an AI agent launches an observe session, explores the UI, and fires annotations via `talox.evaluate()` whenever it finds something wrong. At the end, the session report becomes the test artifact — a Markdown document you can paste directly into a PR comment or GitHub issue.

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

talox.on('sessionEnd', ({ reportPath, interactionCount, annotationCount }) => {
  console.log(`Test report: ${reportPath}`);
  console.log(`${interactionCount} steps · ${annotationCount} issues found`);
});

// debug mode + overlay + record = headless AI-driven observe (no browser window needed)
await talox.launch('ai-test-run', 'qa', 'debug', 'chromium', {
  overlay:   true,
  record:    true,
  output:    'both',
  outputDir: './test-sessions',
});

await talox.navigate('https://my-app.example.com');
const state = await talox.getState();

// Agent annotates detected layout bugs automatically
for (const bug of state.bugs) {
  await talox.evaluate(`
    window.__taloxEmit__('annotation:add', {
      interactionIndex: 1,
      labels: ['bug'],
      comment: ${JSON.stringify(bug.message)},
      element: { tag: 'body', text: '' },
    });
  `);
}

// Agent navigates and checks each page
await talox.click('#checkout');
const checkoutState = await talox.getState();
if (checkoutState.console.errors.length > 0) {
  await talox.evaluate(`
    window.__taloxEmit__('annotation:add', {
      interactionIndex: 2,
      labels: ['bug'],
      comment: 'Console errors on checkout: ' + ${JSON.stringify(checkoutState.console.errors[0])},
      element: { tag: 'button', text: 'Checkout' },
    });
  `);
}

// End session — report auto-generated
await talox.evaluate(`window.__taloxEmit__('session:end', {})`);
```

This produces a Markdown report with every issue attached to the specific element where it was found — something impossible with traditional assertion-based tests. Human testers can also annotate the same session simultaneously by right-clicking and using Comment Mode, mixing human judgment with automated detection in a single unified report.

---

## Use Cases

- **AI agent browsing** — give your agent a persistent, stateful browser with structured output
- **QA automation** — detect layout bugs, JS errors, and visual regressions automatically
- **Debugging** — full observability into what the browser sees, with replay support
- **Research workflows** — stateful sessions with session continuity and network recording
- **Fragile UI automation** — human-paced interaction reduces flakiness on complex real-world interfaces
- **Agent development** — structured JSON state makes it easy to build and test agent decision logic
- **Observe-driven testing** — AI agent explores UI, annotates issues, generates PR-ready reports

---

## Technical Specs

| Feature | Detail |
| :--- | :--- |
| Engine | Playwright (Chromium, Firefox, WebKit) |
| Modes | `adaptive`, `debug`, `speed`, `balanced`, `browse`, `qa` |
| Interaction | Quintic-eased Cubic Bezier with variable timing |
| Perception | AX-Tree + DOM + Console + Network → single JSON contract |
| Visual Diff | Pixelmatch (1px), SSIM, OCR (Tesseract.js) |
| LLM Tools | 14 function-calling tools for AI agents |
| Events | navigation, stateChanged, consoleError, bugDetected, modeChanged |
| Node.js | ≥ 18 |

---

## Harbor Integration

Talox is the browser runtime layer. [Harbor](https://github.com/AVANT-ICONIC/Harbor) is the commercial control plane built on top of it.

Talox Core handles: browser lifecycle, profile persistence, state collection, observability, and local agent interaction.

Harbor handles: multi-agent orchestration, approvals, budgets, team governance, secrets management, and managed cloud operations.

See [`docs/HARBOR-BOUNDARY.md`](./docs/HARBOR-BOUNDARY.md) for the full boundary definition.

---

## Licensing

Talox Core is licensed under **AGPL-3.0-only**.

This means: if you run a modified version of Talox as a networked service, you must make the source of your modifications available under the same license.

Harbor and any other commercial layers built by AVANT ICONIC are separate products and are not part of this repository.

If you need a commercial license for embedding Talox in a proprietary product, contact [office@avant-iconic.com](mailto:office@avant-iconic.com).

---

## Contributing

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit and push
4. Open a Pull Request

External contributions may be subject to a Contributor License Agreement (CLA) or Developer Certificate of Origin (DCO) as the project governance matures. See [CONTRIBUTING.md](./CONTRIBUTING.md) for current guidelines.

See [SECURITY.md](./SECURITY.md) for vulnerability reporting.

---

<div align="center">

<strong>Built for agents that need to act with precision — not bots that act like scripts.</strong>

<br />
<br />

<img src="https://capsule-render.vercel.app/api?type=waving&section=footer&height=130&color=0:0d9488,50:0f766e,100:000000" alt="Talox footer" width="100%" />

</div>
