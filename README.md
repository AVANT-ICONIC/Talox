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
  <a href="#talox-cli"><img src="https://img.shields.io/badge/Talox%20CLI-0a5b86?style=for-the-badge&logo=terminal&logoColor=white" alt="Talox CLI" /></a>
  <a href="#browser-lab"><img src="https://img.shields.io/badge/browser%20lab-0a5b86?style=for-the-badge&logo=experiment&logoColor=white" alt="Browser Lab" /></a>
  <a href="#contributing"><img src="https://img.shields.io/badge/contributing-115e59?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Contributing" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Playwright-Chromium-45ba4b?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/License-AGPL--3.0--only-0d9488?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="AGPL-3.0-only" />
  <img src="https://img.shields.io/github/v/release/AVANT-ICONIC/Talox?color=0d9488<img src="https://img.shields.io/badge/version-7.6.0-0d9488?style=flat-square" alt="v7.6.0" />style=flat-square" alt="version" />
</p>

<p align="center">
  <strong>Local browser runtime for agents.</strong><br />
  Stealth interaction layer. Structured page state. Resilient automation. Deep observability for real-world UIs.
</p>

<p align="center">
  <a href="./docs/TALOX-SPEC.md">Spec</a>
  ·
  <a href="./docs/TALOX-ARCHITECTURE.md">Architecture</a>
  ·
  <a href="./docs/TALOX-ROADMAP.md">Roadmap</a>
  ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

</div>

## Contents

- [Overview](#overview)
- [Why Not Plain Playwright?](#why-not-plain-playwright)
- [Quick Start](#quick-start)
- [Talox CLI & Packaging](#talox-cli--packaging)
- [Integrations](#integrations)
  - [CLI-first](#cli-first-recommended)
  - [OpenAI function calling](#openai-function-calling)
  - [Claude / Anthropic](#claude--anthropic-prompts)
  - [Codex CLI](#codex-cli-wrapper)
- [Browser Lab Demo](#browser-lab-demo)
- [Agent Overlay & Human Takeover](#agent-overlay--human-takeover)
- [Agent-First Vision (v7.6.0)](#agent-first-vision)
- [CAPTCHA Solving (v7.6.0)](#captcha-solving)
- [Interaction Quality Score (v7.6.0)](#interaction-quality)
- [Architecture](#architecture)
- [Stats](#stats)
- [Contributing](#contributing)


## Category focus

- **Talox = browser runtime** — Local-first, structured state, resilient interaction, and takeover-ready observability are what Talox delivers.
- **Not Talox** = cloud search, hosted scraping, or any generic automation platform that tries to be everything.

---

## Overview

Talox is a **local browser runtime** — agents work inside a real browser with maximum stealth and human-like behavior. Everything is always on: HumanMouse (Bezier paths, Fitts's Law), BotDetector, AdaptationEngine, full AX-tree perception — no modes, no toggling. Every action returns a structured JSON contract: AX-Tree, DOM state, console output, network events, and visual diffs — ready for any agent to consume directly, without parsing HTML or interpreting screenshots.

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController({ settings: { verbosity: 0 } });  // v4 shorthand

// Agent does everything with full stealth — always on
await talox.launch('my-agent', 'ops');
const state = await talox.navigate('https://example.com');
await talox.click('button[type=submit]');  // HumanMouse, stealth, always on

await talox.stop();
```

```typescript
// Headed mode — shows browser with glow frame + fake cursor overlay
const talox = new TaloxController({ headed: true });  // v4 shorthand

// Human Takeover — agent pauses, human does a step (e.g., login, 2FA)
await talox.requestHumanTakeover('Need 2FA code');
// → cyan glow → amber, "▶ Resume Agent" button appears
// human does their thing
talox.resumeAgent();  // or auto-resumes after timeout
```

---

## Why Not Plain Playwright?

| Capability | Plain Playwright | Talox |
| :--- | :---: | :---: |
| Basic browser automation | ✓ | ✓ |
| Stealth / human-like interaction layer | — | ✓ Biomechanical Ghost Engine |
| Structured agent-readable page state | — | ✓ Single JSON contract |
| Resilient interaction defaults | — | ✓ Self-healing selectors, semantic resolution |
| Deep observability in one contract | — | ✓ AX-Tree, console, network, bugs |
| Human takeover / debug visibility | — | ✓ Agent overlay, takeover bridge |
| Real-world UI workflows | Fragile | ✓ Human-paced, adaptive timing |

---

## Talox vs other runner stories

Talox's mission is to be the obvious local-first browser runtime. The table below contrasts that focus with other well-known agent/browser automation options so the positioning stays sharp.

| Experience | Category | Why Talox wins |
| :--- | :--- | :--- |
| **Talox** | Local browser runtime for agents | Structured state contract, resilience-first interaction, takeover-ready observability, and optional headed overlay keep Talox grounded in real-world UI work. |
| **Webclaw** | Cloud automation + scraping | Heavy remote tooling; Talox keeps the browser local so agents control data, sessions, and human takeover without third-party lock-in. |
| **Crawl4AI** | Hosted crawling + QA bots | Built for fleets and scale; Talox trades scale for fidelity with persistent local sessions, biomechanical interactions, and deep debug artifacts. |
| **browser-use** | Playwright + heuristics | Useful for scripted flows but lacks Talox’s takeover hooks, verbose telemetry, and structured JSON contract — Talox is designed as an agent runtime, not just UI scripting. |
| **pebkac** | Operator cockpit | Inspires the operator mindset, but Talox keeps the runtime disciplined: optional tools/overlays, no hosted chaos. |

---

## Quick Start

> **npm package coming soon.** For now, install directly from GitHub:

```bash
git clone https://github.com/AVANT-ICONIC/Talox.git
cd Talox
npm install
npm run build
# Install Playwright Chromium (first time or on a new server)
npx playwright install chromium --with-deps
```

<!-- Once published to npm, replace the block above with:
```bash
npm install talox
# Install Playwright Chromium system dependencies (first time or on a new server)
npx playwright install chromium --with-deps
```
-->

### Dependencies explained

Talox ships two browser automation packages:

| Package | Role | When it's used |
| :--- | :--- | :--- |
| **playwright-core** | Chromium automation engine | All core automation: navigating, clicking, typing, AX-tree collection, console/network interception. Uses system Chrome for real browser fingerprint. |

Talox uses `playwright-core` with `channel: "chrome"` for maximum stealth — system Chrome provides a real browser fingerprint. The 19-layer JS stealth stack is injected via `addInitScript` before any page scripts run.

```typescript
import { TaloxController } from 'talox';

// v4: config object as first arg
const talox = new TaloxController({ headless: true });

await talox.launch('my-agent', 'ops');

const state = await talox.navigate('https://example.com');

// Talox returns structured JSON — no HTML parsing needed
console.log('Title:', state.title);
console.log('Interactive elements:', state.interactiveElements.length);
console.log('Layout bugs detected:', state.bugs.length);

await talox.stop();
```

See [examples/minimal-agent.ts](./examples/minimal-agent.ts) for a copy-paste starting point.

## Talox CLI & Packaging

> **npm package coming soon.** Until then, run the CLI from the repo:
> `node dist/cli/talox.js observe --help`

- `node dist/cli/talox.js observe` starts the human-visible observe mode with headed browser, overlay, Markdown/HTML reporting, and the `window.__taloxEmit__` bridge so you can annotate interactions while the agent runs.
- `node dist/cli/talox.js run` starts the autonomous task execution loop with an LLM planner for self-driving browser workflows.
- `node dist/cli/talox.js skill create` interactively creates a new SKILL.md file for per-site strategies.
- `node dist/cli/talox.js init` (aka the `create-talox-app` workflow) scaffolds a clean `talox-app` starter project with `PRESETS.observe`, `ts-node`/`typescript` tooling, Playwright install scripts, and `examples/browser-lab.ts`.
- Exported presets (`ops`, `qa`, `observe`, `research`, `login-heavy`) live in `src/presets.ts` so you can reuse curated verbosity, headedness, and human-takeover posture with a single spread or merge.
- The practical tools from `getPracticalTools(talox)` demonstrate background tabs, API response capture, Markdown snapshot export, on-site search, and visible structured content extraction, so your packaged profiles already include actionable browser lab helpers.

## Browser Lab Demo

`examples/browser-lab.ts` walks through a sandbox profile that:

- launches `PRESETS.observe` with headed overlay/recording enabled,
- exercises every practical tool (background tab, API capture, Markdown snapshot, search, structured content), and
- writes the generated Markdown/JSON report artifacts into `talox-sessions/` (useful as a sanity check after `npm install && npm run build` + `npx playwright install chromium`).

Run the demo to validate the packaged presets, tools, and reporting output in one headed experiment.

---

## Integrations

Talox ships as a flexible Node package with a CLI-first philosophy. The most efficient way to use Talox is through the CLI or direct Node.js scripting — no context-window bloat from MCP servers. For the community, an MCP server is also available for agents that prefer tool-use protocols.

### CLI-first (recommended)

The `talox` CLI provides direct, efficient access to the runtime. No MCP server startup, no context pollution — just shell commands:

```bash
# Launch an observe session with human overlay
talox observe --profile my-session --format both

# Scaffold a new project
talox init my-agent-project

# Pipe structured state to any tool
talox state --url https://example.com --compact agent | jq '.interactiveElements'
```

For more complex workflows, write a small script and run it with `npx tsx`:

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');
await talox.launch('my-agent', 'ops');
const state = await talox.navigate('https://example.com');
console.log(JSON.stringify(state, null, 2));
await talox.stop();
```

### Using with `mcp2cli`

If an MCP server is your only option, use `mcp2cli` to bridge it to the CLI — keeping your agent context clean:

```bash
mcp2cli run talox-mcp -- talox_navigate --url https://example.com
```

### OpenAI function calling

Talox can act as the backend for an OpenAI function-calling loop: the model decides when to ask Talox to navigate, click, or read state, and you just forward the structured result back into the prompt.

```typescript
import OpenAI from 'openai';
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');
await talox.launch('openai-agent', 'ops');

const completion = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Visit https://example.com and tell me the hero heading.' }],
  functions: [{
    name: 'taloxNavigate',
    description: 'Ask Talox to open a page and return the structured state',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Target URL' } },
      required: ['url']
    }
  }],
  function_call: { name: 'taloxNavigate' }
});

const args = JSON.parse(completion.choices?.[0].message?.function_call?.arguments ?? '{}');
const state = await talox.navigate(args.url);
console.log('OpenAI saw', state.title);
await talox.stop();
```

Return the JSON blob directly to the model or feed slices (like `state.interactiveElements`) into observability prompts for iterative reasoning.

### Claude / Anthropic prompts

Anthropic-style prompts can read structured state just like a browser log. Capture Talox's contract, interpolate it into the natural-language prompt, and let Claude summarize the UI or choose the next step.

```typescript
import { Anthropic, HUMAN_PROMPT, AI_PROMPT } from '@anthropic-ai/sdk';
import { TaloxController } from 'talox';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const talox = new TaloxController('./profiles');
await talox.launch('claude-agent', 'ops');

const state = await talox.navigate('https://example.com');
const prompt = `${HUMAN_PROMPT}Summarize the main heading and next action from this structured page state:${JSON.stringify(state, null, 2)}${AI_PROMPT}`;
const response = await anthropic.responses.create({ model: 'claude-3.2', input: prompt });
console.log('Claude answered', response.output[0].content[0].text);
await talox.stop();
```

Claude can also choose when to request a takeover or escalate to headed mode by inspecting the same state blob.

### Codex CLI wrapper

Write a small script that uses `TaloxController`, then execute it with `npx codex run scripts/codex-talox.mjs` so Codex orchestrates Talox like any other skill.

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');
await talox.launch('codex-agent', 'ops');
const state = await talox.navigate('https://example.com');
console.log(JSON.stringify(state, null, 2));
await talox.stop();
```

Codex can read the printed JSON, pass it into its function-calling loop, or pipe it into another skill for further analysis.

### Local scripts & sidecars

Talox profiles can hand off state to any local script, so you can shape the observability contract in Python, Rust, or whatever language your ops team prefers.

```typescript
import { TaloxController } from 'talox';
import { spawn } from 'node:child_process';

const talox = new TaloxController('./profiles');
await talox.launch('local-agent', 'ops');
const state = await talox.navigate('https://example.com');

const exporter = spawn('python3', ['scripts/consume-state.py'], { stdio: ['pipe', 'inherit', 'inherit'] });
exporter.stdin.write(JSON.stringify(state));
exporter.stdin.end();
await talox.stop();
```

Any local script that reads from stdin or a temporary file can pick apart `state.interactiveElements`, `state.bugs`, or `state.timings` before feeding the result back to another automation layer.

---

## Key Capabilities

- **Persistent browser profiles** — each agent gets its own isolated browser context with session continuity across runs
- **Everything always on** — HumanMouse, BotDetector, AdaptationEngine, full AX-tree perception active by default, no mode required
- **Agent overlay with human takeover** — visual layer shows agent working (cyan glow), human can pause and take control anytime
- **Human-paced mouse movement** — HumanMouse generates Bezier curves with Fitts's Law timing, jitter, and biomechanical easing for realistic interaction
- **Structured state contract** — every action returns a single JSON object: AX-Tree, interactive elements, console, network, bugs, screenshots
- **Deep observability** — full AX-Tree snapshots, console capture, network failure tracking, layout bug detection, visual regression
- **Resilient interaction** — self-healing selectors, semantic element resolution, challenge detection and adaptation
- **Session artifacts** — interaction timeline, screenshots, event log, annotations, and bug summaries for debugging
- **Policy-as-code** — YAML-based action restrictions per profile
- **LLM-native API** — 14 function-calling tools compatible with OpenAI, Claude, and other LLM APIs

---

## Autonomous Loop & Self-Learning

v6.0.0 introduces a self-driving execution engine. `AutonomousLoop` runs a plan-execute-observe cycle driven by an LLM `Planner`. When the agent hits a blocker it cannot resolve, the planner generates a reusable skill via `SkillWriter`. On future runs, `SkillLoader` auto-discovers and injects those skills by hostname — so the agent improves over time without manual prompting.

```typescript
import { TaloxController, AutonomousLoop, LLMPlanner } from 'talox';

const talox = new TaloxController({ headless: true });
await talox.launch('auto-agent', 'ops');

const planner = new LLMPlanner({ apiKey: process.env.OPENAI_API_KEY });
const loop = new AutonomousLoop(talox, planner, { maxSteps: 50 });

// Subscribe to loop events for observability
talox.on('loopStep', (e) => console.log(`Step ${e.data.step}: ${e.data.action}`));
talox.on('loopStuck', (e) => console.log('Stuck, recovering...', e.data.reason));
talox.on('skillGenerated', (e) => console.log('New skill written:', e.data.path));

const result = await loop.run('Navigate to example.com and find the main heading');
console.log('Result:', result.status); // 'completed' | 'stuck' | 'error'

await talox.stop();
```

### Key components

| Module | Role |
| :--- | :--- |
| `AutonomousLoop` | Plan-execute-observe cycle with convergence detection |
| `LLMPlanner` | LLM-backed planner; decides next actions and generates skills from blockers |
| `SkillWriter` | Writes SKILL.md files from blocker analysis |
| `SkillLoader` | Auto-discovers and loads skills by hostname |
| `resolveChallenge()` | Public API on `TaloxController` for programmatic challenge resolution |

### New CLI commands

```bash
talox run              # Start an autonomous task execution loop
talox skill create     # Interactively create a new skill file
```

---

## Agent Overlay

When `settings.headed === true`, Talox automatically injects a visual overlay into the browser. The overlay persists across all page navigations and shows the agent working in real-time.

### Visual States

**Agent Running (default)**
- **Cyan pulsing glow** — 3px inset border with 2s breathing pulse animation around the viewport
- **"⏸ Take Over" button** — appears at bottom-center on mouse-enter, auto-hides after 5s idle

**Human Takeover Active**
- Glow off
- **"▶ Resume Agent" button** — always visible in amber
- Human browses freely
- Optional timer countdown if `humanTakeoverTimeoutMs > 0`

### Technical Details

- All overlay elements carry `aria-hidden="true"` — invisible to agent's AX-tree
- Overlay is pure JavaScript, injected via `page.addInitScript()` (persists across navigations)
- Node.js ↔ browser communication via `page.exposeFunction('__taloxBridge__', handler)` and `__taloxCmd__` dispatcher

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

If you just want to launch an ad-hoc observe session, the bundled CLI makes it one command:

```bash
# From the repo (npm package coming soon)
node dist/cli/talox.js observe --profile my-observe-run --class qa --browser chromium --output-dir ./talox-sessions --format both
```

That command opens a headed Chromium session with the overlay + annotation buffer already armed, logs console/network errors, and writes JSON/Markdown reports. Run `talox observe --help` to tune the profile class, browser, verbosity, or report directory without touching code.

Each session now lives inside its own subfolder under the configured output directory (default `talox-sessions/session-{id}-{timestamp}`). The folder contains `report.json`, `report.md`, `report.html`, `timeline.json`, `event-log.json`, `failures.json`, `diffs.json`, `bugs.json`, and `trace.json`, along with a `screenshots/` directory for before/after snapshots. The HTML report surfaces the timeline, event log, diffs, bug summaries, and artifact trace so you can understand why clicks, selectors, or adaptations behaved the way they did.

This produces a Markdown report with every issue attached to the specific element where it was found — something impossible with traditional assertion-based tests.

---

## Use Cases

- **AI agent browsing** — give your agent a persistent, stateful browser with structured output
- **QA automation** — detect layout bugs, JS errors, and visual regressions automatically
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

## Licensing

Talox Core is licensed under **AGPL-3.0-only**.

This means: if you run a modified version of Talox as a networked service, you must make the source of your modifications available under the same license.

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
