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
  <a href="#key-capabilities"><img src="https://img.shields.io/badge/capabilities-0f766e?style=for-the-badge&logo=sparkles&logoColor=white" alt="Key Capabilities" /></a>
  <a href="#agent-overlay"><img src="https://img.shields.io/badge/overlay-0d9488?style=for-the-badge&logo=eye&logoColor=white" alt="Agent Overlay" /></a>
  <a href="#architecture"><img src="https://img.shields.io/badge/architecture-0d9488?style=for-the-badge&logo=gitbook&logoColor=white" alt="Architecture" /></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/quick%20start-134e4a?style=for-the-badge&logo=rocket&logoColor=white" alt="Quick Start" /></a>
  <a href="#contributing"><img src="https://img.shields.io/badge/contributing-115e59?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Contributing" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Playwright-Chromium-45ba4b?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-0d9488?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="AGPL-3.0-only" />
  <img src="https://img.shields.io/badge/version-2.0.0-0d9488?style=flat-square" alt="version" />
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

Talox is an **agent-first browser** — AI agents use it to do all browser work with maximum stealth and human-like behavior. Everything is always on: HumanMouse (Bezier paths, Fitts's Law), BotDetector, AdaptationEngine, full AX-tree perception — no modes, no toggling. Every action returns a structured JSON contract: AX-Tree, DOM state, console output, network events, and visual diffs — ready for any agent to consume.

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles', {
  settings: { verbosity: 0 }  // silent by default
});

// Agent does everything with full stealth — always on
await talox.launch('my-agent', 'ops');
const state = await talox.navigate('https://example.com');
await talox.click('button[type=submit]');  // HumanMouse, stealth, always on

await talox.stop();
```

```typescript
// Headed mode — shows browser with glow frame + fake cursor overlay
const talox = new TaloxController('./profiles', {
  settings: { headed: true }  // overlay auto-activates
});

// Human Takeover — agent pauses, human does a step (e.g., login, 2FA)
await talox.requestHumanTakeover('Need 2FA code');
// → cyan glow → amber, "▶ Resume Agent" button appears
// human does their thing
talox.resumeAgent();  // or auto-resumes after timeout
```

---

## Key Capabilities

- **Persistent browser profiles** — each agent gets its own isolated browser context with session continuity across runs
- **Everything always on** — HumanMouse, BotDetector, AdaptationEngine, full AX-tree perception active by default, no mode required
- **Agent overlay with human takeover** — visual layer shows agent working (cyan glow, fake cursor trail, spinner), human can pause and take control anytime
- **Synthetic mouse events** — OS cursor stays still during automation; Bezier paths render visually via fake cursor, only final click moves the real cursor
- **Structured state contract** — every action returns a single JSON object: AX-Tree, interactive elements, console, network, bugs, screenshots
- **Deep observability** — full AX-Tree snapshots, console capture, network failure tracking, layout bug detection, visual regression
- **Resilient interaction** — human-paced timing, self-healing selectors, semantic element resolution
- **Session replay** — GhostVisualizer overlays interaction paths on screenshots for debugging
- **Policy-as-code** — YAML-based action restrictions per profile
- **LLM-native API** — 14 function-calling tools compatible with OpenAI, Claude, and other LLM APIs

---

## Agent Overlay

When `settings.headed === true`, Talox automatically injects a visual overlay into the browser. The overlay persists across all page navigations and shows the agent working in real-time.

### Visual States

**Agent Running (default)**
- **Cyan pulsing glow** — 3px inset border with 2s breathing pulse animation around the viewport
- **Fake cyan arrow cursor** — follows agent mouse path with a 12-point comet trail (fading points)
- **Spinner ring** — orbits the cursor during `think()` or `fidget()` states
- **Click animation** — cursor shrinks + ripple expands on every click
- **Click blocker** — transparent overlay prevents accidental human interference
- **"⏸ Take Over" button** — appears at bottom-center on mouse-enter, auto-hides after 5s idle

**Human Takeover Active**
- Glow off, cursor hidden, click-blocker removed
- **"▶ Resume Agent" button** — always visible in amber
- Human browses freely — right-click context menu still available
- Optional timer countdown if `humanTakeoverTimeoutMs > 0`
- On resume: cursor sweeps in from nearest screen edge with trail

### Technical Details

- All overlay elements carry `aria-hidden="true"` — invisible to agent's AX-tree
- Overlay is pure JavaScript, injected via `page.addInitScript()` (persists across navigations)
- OS cursor only moves at the final click target — NOT during Bezier path traversal
- Node.js ↔ browser communication via `page.exposeFunction('__taloxAgentBridge__', handler)`

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

## Observation & Debugging

Talox provides maximum observability into what the agent sees, without interfering with it:

- Full AX-Tree snapshot as agent-readable JSON
- All interactive elements with bounding boxes
- Console errors, warnings, and logs
- Network failures and 4xx/5xx responses
- Layout bug detection: overlaps, clipped elements, invisible CTAs
- Visual regression via Pixelmatch + SSIM
- OCR text extraction from screenshots (Tesseract.js)
- AX-Tree structural diffing between states
- GhostVisualizer: overlays interaction paths on screenshots for replay
- Runtime verbosity control via `setVerbosity(0-3)` for pulling debug data on demand
- `getDebugSnapshot()` returns current state + recent events at any time

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

const talox = new TaloxController('./profiles', {
  settings: { verbosity: 0 }  // silent by default
});

// Agent does everything with full stealth
await talox.launch('agent-1', 'ops');
const state = await talox.navigate('https://example.com');
console.log(state.axTree);

// Pull debug snapshot on demand
talox.setVerbosity(2);
const debugState = await talox.getDebugSnapshot();
console.log(debugState.bugs);
talox.setVerbosity(0);

await talox.stop();
```

---

## Observation Sessions

Talox supports structured observation sessions where an AI agent or human can annotate issues in real-time as they explore:

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles', {
  observe: true  // enables annotation and session reporting
});

talox.on('sessionEnd', ({ reportPath, interactionCount, annotationCount }) => {
  console.log(`Test report: ${reportPath}`);
  console.log(`${interactionCount} steps · ${annotationCount} issues found`);
});

// Headless session with overlay-driven annotations and session report
await talox.launch('ai-test-run', 'qa', 'chromium', {
  output: 'both',
  outputDir: './test-sessions',
});

await talox.navigate('https://my-app.example.com');
const state = await talox.getState();

// Agent annotates detected layout bugs
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

This produces a Markdown report with every issue attached to the specific element where it was found — something impossible with traditional assertion-based tests.

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
| Interaction | Fitts's Law + Quintic easing + Bezier curves, synthetic mouse events (OS cursor stays still) |
| Perception | AX-Tree + DOM + Console + Network → single JSON contract, always on |
| Overlay | Agent glow frame, fake cursor trail, human takeover layer (when headed: true) |
| Visual Diff | Pixelmatch (1px), SSIM, OCR (Tesseract.js) |
| Verbosity | Runtime control via `setVerbosity(0-3)`, no modes |
| LLM Tools | 14 function-calling tools for AI agents |
| Events | navigation, stateChanged, consoleError, bugDetected, agentThinking, agentActing, cursorClicked |
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
