<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&height=250&color=0:000000,40:0f172a,75:0f766e,100:0d9488&text=TALOX&fontColor=ffffff&fontSize=72&fontAlignY=35&desc=by%20AVANT%20ICONIC&descSize=15&descAlignY=52&animation=scaleIn" alt="Talox header" width="100%" />

<br />

<img src="https://readme-typing-svg.demolab.com?font=Inter&weight=600&size=22&pause=1200&color=2DD4BF&center=true&vCenter=true&width=980&lines=AI-agent-first+browser+controller.;Stealth+mode+defeats+bot+detection.+Debug+mode+sees+everything.;Give+your+agent+a+persistent%2C+human-like+browser." alt="Typing SVG" />

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
  <img src="https://img.shields.io/badge/License-ISC-0d9488?style=flat-square&logo=opensourceinitiative&logoColor=white" alt="ISC" />
  <img src="https://img.shields.io/badge/version-1.1.0-0d9488?style=flat-square" alt="version" />
</p>

<p align="center">
  <strong>Talox</strong> is an AI-agent-first browser controller built on Playwright.<br />
  Stealth mode defeats bot detection. Debug mode gives your agent full observability. Both modes return a single structured JSON contract.
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

---

## Overview

Talox gives AI agents a **persistent, human-like browser** with two primary modes:

- **Stealth** — evades bot detection and anti-captcha systems using the Biomechanical Ghost engine
- **Debug** — maximizes observability for root-cause analysis without interfering with the agent

Every mode returns the same structured JSON contract: AX-Tree, DOM state, console output, network events, and visual diffs — ready for any agent to consume.

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

await talox.launch('my-agent', 'ops', 'stealth');
const state = await talox.navigate('https://example.com');

await talox.setMode('debug');
const debugState = await talox.getState();

await talox.stop();
```

---

## Modes

| Mode | Purpose | Mouse Speed | Human Simulation |
| :--- | :--- | :--- | :--- |
| `stealth` | Anti-bot evasion, captcha bypass | 0.7× | Full — Fitts's Law, Bezier curves, typos, fidget |
| `debug` | Root-cause analysis, full observability | 1.0× | Minimal — no interference |
| `balanced` | General-purpose agent tasks | 1.0× | Moderate |
| `speed` | High-throughput automation | 3.0× | None |
| `browse` | Human-like browsing sessions | 1.0× | Full |
| `qa` | Testing and verification | 1.5× | Light |

---

## 👻 The Biomechanical Ghost

Stealth mode runs the **Biomechanical Ghost** engine — a mouse and interaction system that mimics human neuro-muscular movement patterns to defeat bot detection.

- **Fitts's Law** — movement speed scales naturally with target size and distance
- **Quintic Easing** — natural "burst and settle" acceleration curves
- **Bezier Pathing** — non-linear, organic trajectories with micro-jitter
- **Physical Press Logic** — clicks include micro-drags and variable duration
- **Typo Simulation** — realistic keystroke errors with backspace corrections
- **Adaptive Stealth** — adjusts behavior based on UI density
- **Behavioral DNA** — unique per-profile interaction fingerprint

---

## 👁️ Debug Mode

Debug mode maximizes what the agent can see without interfering with it.

- Full AX-Tree snapshot as agent-readable JSON
- All interactive elements with bounding boxes
- Console errors, warnings, and logs
- Network failures and 4xx/5xx responses
- Layout bug detection: overlaps, clipped elements, invisible CTAs
- Visual regression via Pixelmatch + SSIM
- OCR text extraction from screenshots (Tesseract.js)
- AX-Tree structural diffing between states
- Ghost Visualizer: overlays mouse paths on screenshots for replay

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                      TaloxController                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ BrowserManager│  │  HumanMouse  │  │ PageStateCollector │ │
│  │  (Playwright) │  │  Ghost Engine│  │  AX-Tree + DOM     │ │
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

| Module | Role |
| :--- | :--- |
| `TaloxController` | Main orchestration API, mode/preset manager |
| `BrowserManager` | Playwright/Chromium lifecycle, persistent profiles |
| `HumanMouse` | Biomechanical Ghost engine |
| `PageStateCollector` | AX-Tree + DOM harvester → agent-ready JSON |
| `VisionGate` | Visual verification: SSIM, Pixelmatch, OCR, baseline vault |
| `RulesEngine` | Layout bug detection via bounding box analysis |
| `SemanticMapper` | Maps AX-Tree to semantic entities for intent-based interaction |
| `SelfHealingSelector` | Auto-rebuilds selectors when DOM changes |
| `NetworkMocker` | Record / replay / mock network traffic |
| `AXTreeDiffer` | Structural diff between AX-Tree snapshots |
| `GhostVisualizer` | Mouse path overlay for session replay and debugging |
| `PolicyEngine` | YAML-based action restrictions per profile |
| `TaloxTools` | LLM function calling schema for AI agents |
| `EventEmitter` | Real-time notifications for navigation, errors, bugs |

---

## Agent-Friendly API

### LLM Function Schema
Talox provides built-in tools compatible with OpenAI function calling, Claude tools, and other LLM APIs:

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
// Get human-readable page description
const description = await talox.describePage();
// "Page: 'Example Domain' at https://example.com. Input fields: search. Buttons: Submit..."

// Get compact intent state for quick decision making
const intent = await talox.getIntentState();
// { pageType: 'search', primaryAction: {...}, inputs: [...], errors: [], bugs: [...] }
```

### Event-Driven Workflows
```typescript
// Subscribe to real-time events
talox.on('navigation', (event) => console.log('Navigated to:', event.data.url));
talox.on('consoleError', (event) => console.log('Error:', event.data.error));
talox.on('bugDetected', (event) => console.log('Bug:', event.data));
```

### Utility Methods
```typescript
// Screenshot
await talox.screenshot(); // full page
await talox.screenshot({ selector: '#hero', path: 'hero.png' });

// Scroll
await talox.scrollTo('#footer', 'center');

// Extract table data
const rows = await talox.extractTable('table.product-list');

// Execute JavaScript
const title = await talox.evaluate(() => document.title);

// Find element by text
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

## Quick Start

```bash
npm install talox
```

```typescript
import { TaloxController } from 'talox';

const talox = new TaloxController('./profiles');

// Stealth session
await talox.launch('agent-1', 'ops', 'stealth');
const state = await talox.navigate('https://example.com');
console.log(state.axTree);

// Switch to debug for analysis
await talox.setMode('debug');
const debugState = await talox.getState();
console.log(debugState.bugs);

await talox.stop();
```

---

## Technical Specs

| Feature | Detail |
| :--- | :--- |
| Engine | Playwright (Chromium, Firefox, WebKit) |
| Modes | `stealth`, `debug`, `speed`, `balanced`, `browse`, `qa` |
| Mouse Pathing | Quintic-eased Cubic Bezier with speed-scaled jitter |
| Perception | AX-Tree + DOM + Console + Network → single JSON contract |
| Visual Diff | Pixelmatch (1px), SSIM, OCR (Tesseract.js) |
| LLM Tools | 14 function-calling tools for AI agents |
| Events | navigation, stateChanged, consoleError, bugDetected, modeChanged |
| Node.js | ≥ 18 |

---

## Contributing

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit and push
4. Open a Pull Request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full guidelines and [SECURITY.md](./SECURITY.md) for vulnerability reporting.

---

<div align="center">

<strong>Built for agents that need to act like humans — not bots that act like agents.</strong>

<br />
<br />

<img src="https://capsule-render.vercel.app/api?type=waving&section=footer&height=130&color=0:0d9488,50:0f766e,100:000000" alt="Talox footer" width="100%" />

</div>
