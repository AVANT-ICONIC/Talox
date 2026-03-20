# Talox v2 — Architecture & Vision Specification

## The One-Line Vision

> **Talox IS the human.** Agent-first browser with maximum stealth always on, full trust on any website, human takeover when the agent needs a hand.

---

## Why v2?

v1 had a **mode system** (`smart | speed | debug | observe`) that forced you to pick a capability bundle upfront. This was wrong for the actual use case:

- **Agents don't want to think about modes.** They want to browse.
- **Stealth should never be optional.** Every interaction needs to look human.
- **Debug info should be there when you want it**, not a different mode you have to restart in.
- **Human takeover** doesn't fit any of the four modes — it's a different dimension entirely.

v2 removes modes entirely. Everything is always on. You reduce only when you explicitly need less.

---

## What Talox v2 Is

An AI agent picks up `TaloxController`, tells it a profile, and starts browsing. That's it. Under the hood:

- **HumanMouse** moves the cursor with Fitts's Law + quintic easing + Bezier paths + natural jitter — always
- **BotDetector** scans every page for detection signals — always
- **AdaptationEngine** self-heals: if it detects a blocker, it applies a stealth strategy automatically — always
- **Full AX-tree + DOM + console + network capture** — always (the agent's senses are never crippled)
- **Bug detection** (layout overlap, JS errors, clipped elements, network failures) — always on, silent by default
- **Session persistence** via profiles (localStorage, cookies, behavioral DNA) — always
- **Typing simulation** (variable cadence, occasional typos, realistic delays) — always

The agent does whatever you tell it. Login to your Google account. Fill out a form. Click through a checkout. It looks like a real person doing it.

---

## The Two Real Use Cases

### 1. Default: Agent IS the human (primary use case)

```typescript
const talox = new TaloxController({ profile: 'my-google-account' });

await talox.navigate('https://gmail.com');
await talox.click('Sign in');
await talox.type('#identifierId', 'myemail@gmail.com');
// Full stealth. Looks exactly like a human. No mode selection needed.
```

### 2. Observe: Human drives, agent watches (dev side mode)

```typescript
const talox = new TaloxController({
  profile: 'qa-session',
  observe: true,
});
// Browser window opens. Human clicks around.
// Talox captures AX-tree state, bugs, network, annotations.
// On close: generates full session report with issues list.
```

---

## The Human Takeover Layer

Sometimes an agent hits something it can't handle alone:
- CAPTCHA it can't solve
- Payment form where you need to enter your card
- 2FA on your phone
- Unexpected modal it doesn't know how to dismiss

Instead of failing or stalling the whole workflow, the agent calls:

```typescript
await talox.requestHumanTakeover('Hit a CAPTCHA on checkout page');
// Agent freezes. Overlay changes to amber glow. "▶ Resume Agent" button appears.
// You do your thing (solve captcha, enter card, whatever).
// You click "▶ Resume Agent" — or the timer expires — and the agent continues.
```

### Visual states

**Agent running:**
- Subtle pulsing blue/cyan border glow around the browser viewport (2px, `#00d4ff`, 40% opacity)
- Small "⏸ Take Over" pill button in top-right corner
- Shows the agent is in control, alive, working

**Human in control (takeover active):**
- Glow switches to amber/orange (`#ffaa00`) — "you have the wheel"
- Button changes to "▶ Resume Agent"
- If `humanTakeoverTimeoutMs > 0`: countdown shown in button ("▶ Resume Agent (1:47)")
- Agent is completely frozen — no mouse movement, no actions, no auto-scrolling

**Auto-resume:**
- After `humanTakeoverTimeoutMs` milliseconds, agent auto-resumes
- Emits `autoResumed` event with reason `'timeout'`
- Set `humanTakeoverTimeoutMs: 0` to wait forever (agent never auto-resumes)

### Overlay works in both modes

- **Headed browser**: user sees the glow and buttons, clicks them directly
- **Headless**: programmatic only — agent calls `requestHumanTakeover()`, external system calls `resumeAgent()` when ready. No overlay injected.

### CDP Bridge

`TakeoverBridge.ts` is responsible for:
1. Injecting `window.__talox_requestTakeover()` and `window.__talox_resumeAgent()` into the page
2. Listening for calls to these (via CDP `Runtime.bindingCalled`)
3. Routing calls to `TaloxController`'s takeover state machine
4. Injecting/updating the overlay HTML+CSS for glow and button states

---

## Debug = Verbosity, Not a Mode

There is no "debug mode." Debug information is always being collected. You control how much surfaces:

| Level | What you get |
|---|---|
| `0` (default) | Silent. Errors only. Data available via `getDebugSnapshot()`. |
| `1` | Emit `bugDetected`, `networkError`, `consoleError` events live |
| `2` | + emit `adapted` (stealth strategy applied), `selectorRebuilt`, `stateCollected` events |
| `3` | + raw Playwright trace, full AX-tree diffs on every state change |

```typescript
// Pull debug state on demand (any verbosity level)
const snapshot = await talox.getDebugSnapshot();
// Returns: current AX-tree, recent bugs, console errors, network failures,
//          last adaptation applied, interaction history

// Or stream live events
talox.setVerbosity(1);
talox.on('bugDetected', (bug) => console.log(bug));
```

---

## Auto Headed/Headless Switching

Talox starts headless by default. If it detects a blocker it cannot solve headlessly (CAPTCHA requiring visual solve, unusual bot-detection that only passes in a real window), it **automatically relaunches the session headed**, continues the workflow, then **switches back to headless** when the blocker is resolved.

This is an extension of the existing `AdaptationEngine` strategy system. New strategy: `escalate_to_headed`.

```
headless → blocker detected → escalate_to_headed strategy fires
  → relaunch browser headed, restore page state
  → continue workflow (headed)
  → blocker resolved → de-escalate_to_headless strategy fires
  → relaunch headless, continue
```

Emits events: `headedEscalation` (with reason), `headlessRestored`

The agent can also force headed explicitly: `talox.setHeaded(true)` / `talox.setHeaded(false)`.

Note: if `observe: true`, stays headed permanently (human needs to see the window).

---

## Agent-Controlled Verbosity

The agent decides verbosity at runtime — it's part of the agent's toolset, not a fixed config. The agent calls `setVerbosity()` whenever it needs more or less information:

```typescript
// Agent starts quiet
const talox = new TaloxController({ profile: 'my-account' });
// verbosity: 0 by default — silent, no event noise

// Agent is confused about page state — asks for more info
talox.setVerbosity(2);
const snapshot = await talox.getDebugSnapshot();
// Now has full AX-tree diffs, recent bugs, network failures, adaptation history

// Agent resolved the confusion — goes quiet again
talox.setVerbosity(0);
```

This means `setVerbosity()` is also exposed as an **LLM function-calling tool** in `TaloxTools.ts` so LLMs can call it via the 14-tool API without writing code.

Verbosity levels:

| Level | What you get |
|---|---|
| `0` (default) | Silent. Data collected but no events emitted. Pull via `getDebugSnapshot()`. |
| `1` | Emit `bugDetected`, `networkError`, `consoleError` live |
| `2` | + `adapted` (stealth strategy), `selectorRebuilt`, `stateCollected` |
| `3` | + raw Playwright trace, full AX-tree diffs on every state change |

---

## Configuration API

### `TaloxConfig` (what you pass to the constructor)

```typescript
interface TaloxConfig {
  profile?: string;                    // session profile name (default: 'default')
  observe?: boolean;                   // human drives, agent watches (default: false)
  settings?: Partial<TaloxSettings>;  // override any default setting
  humanTakeover?: boolean | {
    timeoutMs?: number;                // 0 = wait forever (default: 120000 = 2min)
  };
}
```

### `TaloxSettings` (the full settings surface)

```typescript
interface TaloxSettings {
  // Interaction fidelity
  mouseSpeed: number;            // 0.1 (slowest) – 3.0 (raw). Default: 0.7
  typingDelayMin: number;        // ms. Default: 100
  typingDelayMax: number;        // ms. Default: 300
  typoProbability: number;       // 0–1. Default: 0.03
  fidgetEnabled: boolean;        // micro-movements. Default: true
  humanStealth: number;          // 0 (off) – 1.0 (full). Default: 1.0

  // Stealth & protection
  stealthLevel: 'low' | 'medium' | 'high';  // Default: 'high'
  adaptiveStealthEnabled: boolean;           // self-healing. Default: true
  automaticThinkingEnabled: boolean;         // Default: true

  // Perception (always full in v2 — field kept for future use)
  perceptionDepth: 'full';

  // Browser — managed automatically, but overrideable
  headed: boolean;               // Default: false. Auto-switches on blocker escalation.
  autoHeadedEscalation: boolean; // Default: true. Agent auto-escalates to headed if stuck.

  // Debug (agent-controlled at runtime via setVerbosity())
  verbosity: 0 | 1 | 2 | 3;    // Default: 0

  // Human takeover
  humanTakeoverEnabled: boolean;    // Default: false
  humanTakeoverTimeoutMs: number;   // Default: 120000 (0 = wait forever)
}
```

### `DEFAULT_SETTINGS` (v2 — everything on)

```typescript
const DEFAULT_SETTINGS: TaloxSettings = {
  mouseSpeed: 0.7,
  typingDelayMin: 100,
  typingDelayMax: 300,
  typoProbability: 0.03,
  fidgetEnabled: true,
  humanStealth: 1.0,
  stealthLevel: 'high',
  adaptiveStealthEnabled: true,
  automaticThinkingEnabled: true,
  perceptionDepth: 'full',
  headed: false,
  autoHeadedEscalation: true,
  verbosity: 0,
  humanTakeoverEnabled: false,
  humanTakeoverTimeoutMs: 120000,
};
```

---

## What Dies in v2

| What | Why |
|---|---|
| `TaloxMode` union type | Replaced by defaults. No modes needed. |
| `ModeManager` class | Folds into constructor defaults. |
| `CANONICAL_MODES`, `DEPRECATED_MODE_MAP`, `resolveMode()` | Gone with modes. |
| `MODE_PRESETS` | Gone with modes. |
| Agent-First 6-dimension model (WIP on `talox-harbor`) | Right problem, wrong solution. Defaults fix it instead. |
| `speed` mode | If you want raw Playwright, use Playwright. Talox is always full-human. |
| `perceptionDepth: 'shallow'` | Was only for speed mode. Gone. |
| `shouldEmitBugDetected()`, `isSpeedMode()`, etc. | Mode-query methods. Gone. |

---

## Module Map (v2)

```
TaloxController (public API + takeover state machine)
├── SessionManager        — browser lifecycle, profiles, warmup
├── ActionExecutor        — click/type/navigate, always via HumanMouse
├── EventBus              — typed events
├── TakeoverBridge        — CDP bridge for overlay ↔ Node takeover
├── ObserveSession        — human-driven sessions (observe:true only)
└── [internal always-on engines]
    ├── HumanMouse        — biomechanical interaction
    ├── BotDetector       — always scanning
    ├── AdaptationEngine  — always self-healing
    ├── PageStateCollector — always full-depth state
    ├── RulesEngine       — always detecting bugs
    ├── SemanticMapper    — AX-tree → intent
    ├── SelfHealingSelector — auto-rebuilds selectors
    ├── GhostVisualizer   — interaction path overlay (+ v2 glow states)
    ├── VisionGate        — visual diff + OCR
    ├── AXTreeDiffer      — structural diffs
    ├── NetworkMocker     — record/replay
    ├── ArtifactBuilder   — screenshot/crop collection
    └── ProfileVault      — session persistence
```

---

## Branch Unification Strategy

### Cherry-picks into `v2` (base: `main`)

| Commit | From branch | What it fixes |
|---|---|---|
| `5b34212` | `bug-investigation/talox-tests` | Stealth browser + mouse movement in smart mode |
| `d6df906` | `talox-harbor` | Observe overlay session controls |
| `1accc29` | `talox-harbor` | Overlay injection idempotent |
| `9807f88` or `88d57f3` | `talox-harbor` | Overlay end events (pick one — they diverged) |
| `3b51b76`, `cced2c6` | `talox-harbor` | CI configs |
| TBD | `experimental/real-world-tests` | Headed mode support, auto-escalation logic, Cloudflare bypass patterns |

### Read first, decide
- `test-extension` — unknown, read before deciding
- `automation/overnight-audit-*` — read, likely discard

### Discard
- All uncommitted Agent-First changes on `talox-harbor` (the WIP on ModeManager/TaloxController/types)
- `speed` mode concept

---

## Test Strategy

All tests live in one place: `tests/`. The next agent decides the exact split but must keep it consolidated — not scattered across branches.

### Recommended structure
```
tests/
  unit/
    TaloxController.test.ts     — default settings, verbosity API, takeover state machine,
                                   headed escalation logic, observe flag wiring
    settings.test.ts            — DEFAULT_SETTINGS shape, partial merge, humanTakeover shorthand
    [other unit tests as needed]
  e2e/
    [existing fixture HTML tests — login forms, navigation, forms]
    [verify HumanMouse always active: timing of interactions > raw Playwright baseline]
  real/
    [Guerrilla Mail, Reddit, X, Stack Overflow, ChatGPT, Grok — from experimental/ branch]
    [these are the integration proof that stealth works — most valuable tests in the repo]
```

### Scripts in `package.json`
```
test        → unit + e2e (always runs in CI)
test:real   → real-world scenarios (optional, network-dependent, nightly in CI)
```

### What to delete
- `tests/core/controller/ModeManager.test.ts`
- `tests/core/controller/modes.test.ts`
Both are mode-system tests — gone with the mode system.

---

## Migration from v1 (for users of the library)

```typescript
// v1
const talox = new TaloxController({ mode: 'smart' });

// v2 — same behavior, no mode needed
const talox = new TaloxController({ profile: 'my-profile' });
// Automatically: stealth high, HumanMouse, AdaptationEngine, full perception

// v1 observe mode
const talox = new TaloxController({ mode: 'observe' });

// v2
const talox = new TaloxController({ observe: true });
```

---

*Spec version: 2.0.0-draft*
*Created: 2026-03-20*
*Replaces: TALOX-AGENT-FIRST-REARCHITECTURE.md*
