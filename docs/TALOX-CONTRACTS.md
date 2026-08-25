# TALOX-CONTRACTS.md — Public Data & API Contracts

> **Canonical sources:** `src/types/index.ts`, `src/types/config.ts`, `src/types/settings.ts`, `src/types/events.ts`, `src/core/controller/TaloxController.ts`, and `src/schema/TaloxPageState.schema.json`.

This document is the human-readable v9 companion to those source files. When prose and TypeScript disagree, the exported TypeScript types and JSON Schema win.

## Compatibility policy

Talox keeps the `TaloxPageState` v1 core stable because agents depend on it for structured reasoning.

1. **Freeze the core contract.** Mandatory v1 fields cannot be removed, renamed, or narrowed without an explicit contract-version migration.
2. **Optional additions are allowed.** New optional fields may be added without breaking existing consumers.
3. **Keep TypeScript and JSON Schema aligned.** Contract changes must update both `src/types/index.ts` and `src/schema/TaloxPageState.schema.json`.
4. **Keep compact variants aligned.** `getState('agent' | 'debug' | 'full')` must remain compatible with the full state contract.
5. **Test schema changes.** `tests/unit/pageState.schema.test.ts` protects the machine-readable contract.
6. **Document breaking changes explicitly.** Breaking state changes require migration notes and a contract-version bump.

`TALOX_STATE_CONTRACT_VERSION` is currently `1`.

---

## 1. `TaloxPageState`

`navigate()`, `click()`, `type()`, and full `getState()` operations return Talox's structured page state.

```typescript
interface TaloxPageState {
  // Frozen v1 core
  url: string;
  title: string;
  timestamp: string;

  console: {
    errors: string[];
    warnings?: string[];
    logs?: string[];
  };

  network: {
    failedRequests: Array<{
      url: string;
      status: number;
      type?: string;
    }>;
    exceptions?: any[];
  };

  nodes: TaloxNode[];

  interactiveElements: Array<{
    id: string;
    tagName: string;
    role?: string;
    text?: string;
    boundingBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    isActionable?: boolean;
    cursorDetected?: boolean;
    detectionMethod?: 'cursor-style' | 'onclick-attr' | 'tabindex';
    trust?: 'first-party' | 'external';
  }>;

  bugs: TaloxBug[];

  // Optional v1-compatible additions
  axTree?: TaloxNode;
  timing?: TaloxStateTiming;
  diff?: TaloxStateDiff;
  profileId?: string;
  domainHints?: string[];
  screenshots?: {
    fullPage?: string;
    crops?: Array<{
      id: string;
      path: string;
      reason: string;
    }>;
  };
}
```

### Important v9 invariants

- There is **no `mode` field** in `TaloxPageState`.
- Public perception depth is currently **`'full'` only**. Do not plan around a `shallow` perception mode.
- `nodes` and `interactiveElements` are always part of the frozen core contract.
- `axTree` remains optional.
- Use `state.timing`, not `state.timings`.
- Cross-origin content can carry `trust: 'external'`; same-origin or explicitly trusted content can carry `trust: 'first-party'`.

### Compact state variants

Use compact variants when a full state would waste agent context:

```typescript
const agentState = await talox.getState('agent');
const debugState = await talox.getState('debug');
const fullState = await talox.getState('full');
```

The compact variants are projections of the same runtime state, not separate browser modes.

---

## 2. `TaloxNode`

```typescript
interface TaloxNode {
  id: string;
  role: string;
  name: string;
  description?: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  attributes?: Record<string, string | boolean>;
  trust?: 'first-party' | 'external';
  children?: TaloxNode[];
}
```

Talox uses browser-computed ARIA semantics plus DOM geometry. `nodes` is the flat ordered representation; `axTree` may contain the hierarchical representation.

---

## 3. `TaloxBug`

Built-in bug types include:

- `JS_ERROR`
- `NETWORK_FAILURE`
- `LAYOUT_OVERLAP`
- `CLIPPED_ELEMENT`
- `INVISIBLE_CTA`
- `VISUAL_REGRESSION`

The public `BugType` is extensible, so consumers must not assume only those built-ins can appear.

```typescript
interface TaloxBug {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  confidence?: number;
  description: string;
  reproductionSteps?: string[];
  evidence: {
    url?: string;
    profile?: string;
    consoleLog?: string;
    networkLog?: string;
    screenshotRef?: string;
    cropRef?: string;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
}
```

---

## 4. Profiles

```typescript
interface TaloxProfile {
  id: string;
  class: 'qa' | 'ops' | 'sandbox';
  purpose: string;
  userDataDir: string;
  policy?: {
    allowedDomains: string[];
    blockedActions: string[];
    extensions: string[];
  };
  metadata: {
    createdAt: string;
    lastUsed: string;
    tags?: string[];
  };
}
```

Profile classes are stable public identifiers:

- `ops` — persistent operational sessions
- `qa` — testing and diagnostic workflows
- `sandbox` — low-risk experimentation

---

## 5. Configuration model

Talox v9 is **settings-first**. Configure runtime behavior through `TaloxConfig.settings`.

```typescript
const talox = new TaloxController('./profiles', {
  settings: {
    headed: false,
    verbosity: 0,
    safeMode: false,
    navigationWaitUntil: 'domcontentloaded',
    contentSafety: 'warn',
  },
});
```

The config-object shorthand is also valid:

```typescript
const talox = new TaloxController({
  settings: { verbosity: 1 },
});
```

Do **not** flatten settings onto `TaloxConfig`. For example, `{ headed: true }` is not the modern constructor shape; use `{ settings: { headed: true } }`.

### Current default settings

| Setting | Default |
| :--- | :--- |
| `mouseSpeed` | `0.7` |
| `typingDelayMin` | `100` ms |
| `typingDelayMax` | `300` ms |
| `typoProbability` | `0.03` |
| `fidgetEnabled` | `true` |
| `humanStealth` | `1` |
| `actionTimeoutMs` | `5000` ms |
| `stealthLevel` | `'high'` |
| `adaptiveStealthEnabled` | `true` |
| `automaticThinkingEnabled` | `true` |
| `perceptionDepth` | `'full'` |
| `headed` | `false` |
| `autoHeadedEscalation` | `true` |
| `verbosity` | `0` |
| `humanTakeoverEnabled` | `false` |
| `humanTakeoverTimeoutMs` | `120000` ms |
| `idleTimeout` | `5000` ms |
| `precisionDecay` | `0.1` |
| `adaptiveStealthSensitivity` | `0.5` |
| `adaptiveStealthRadius` | `100` |
| `navigationWaitUntil` | `'domcontentloaded'` |
| `safeMode` | `false` |
| `autoDialogHandling` | `true` |
| `sessionIdleTimeoutMs` | `300000` ms |
| `enableCrossOriginIframes` | `false` |
| `virtualDisplay` | `false` |
| `contentSafety` | `'warn'` |
| `networkGuard` | `'off'` |
| `trustedDomains` | `[]` |

`navigationWaitUntil: 'domcontentloaded'` is deliberate. Modern SPAs can keep WebSocket, analytics, polling, or background network traffic alive indefinitely, so `networkidle` is opt-in rather than the default.

---

## 6. Legacy mode compatibility

Legacy modes still exist only as constructor compatibility aliases through `resolveLegacyMode()`.

```typescript
// Compatibility form
const oldStyle = new TaloxController('./profiles', { mode: 'debug' });

// Recommended v9 form
const current = new TaloxController('./profiles', {
  settings: {
    verbosity: 3,
    headed: true,
    humanTakeoverEnabled: true,
  },
});
```

Rules for new integrations:

- Do not build around runtime mode switching.
- There is no current `talox.setMode()` API.
- Prefer explicit settings over legacy `smart`, `debug`, `speed`, `observe`, `browse`, `adaptive`, `stealth`, `balanced`, or `qa` aliases.
- `adaptive`, `stealth`, `balanced`, and `qa` are compatibility mappings, not separate modern runtime architectures.

---

## 7. High-use controller API

The exhaustive source of truth is `src/core/controller/TaloxController.ts` and the emitted package declarations. The methods below are the stable, commonly used v9 surface.

| Method | Current call shape | Purpose |
| :--- | :--- | :--- |
| `launch` | `launch(profileId, profileClass, browserType?, observeOptions?)` | Launch/load a persistent browser profile |
| `navigate` | `navigate(url)` | Navigate and return structured page state |
| `click` | `click(selector)` | Click a string selector and return resulting state |
| `type` | `type(selector, text)` | Type into a string selector and return resulting state |
| `getState` | `getState(variant?)` | Read `full`, `agent`, or `debug` state |
| `describePage` | `describePage()` | Human-readable page summary |
| `getIntentState` | `getIntentState()` | Compact intent-oriented state |
| `screenshot` | `screenshot(options?)` | Capture page/element screenshot |
| `scrollTo` | `scrollTo(selector, align?)` | Scroll a selector into view |
| `extractTable` | `extractTable(selector)` | Extract structured table rows |
| `waitForLoadState` | `waitForLoadState(state, timeout?)` | Explicitly wait for a browser load state |
| `setVerbosity` | `setVerbosity(level)` | Change diagnostic detail at runtime |
| `setHeaded` | `setHeaded(headed)` | Switch headed/headless operation |
| `setSafeMode` | `setSafeMode(enabled)` | Toggle deterministic interaction behavior |
| `verifyVisual` | `verifyVisual(baselineKey, autoSave?)` | Compare against a stored visual baseline |
| `findElement` | `findElement(text, elementType?)` | Resolve an element by text/accessibility semantics |
| `evaluate` | `evaluate(script)` | Execute JavaScript source in browser context |
| `requestHumanTakeover` | `requestHumanTakeover(reason, ...)` | Hand control to a human for a typed takeover reason |
| `resumeAgent` | `resumeAgent()` | Resume after human takeover |
| `stop` | `stop()` | Close the browser session and clean up |

### Interaction argument contract

Current interaction calls use positional/string arguments:

```typescript
await talox.click('button[type="submit"]');
await talox.type('input[name="email"]', 'agent@example.com');
```

Do not use obsolete object-shaped calls such as:

```typescript
// obsolete
await talox.click({ selector: '#submit' });
await talox.type({ selector: '#email', text: 'agent@example.com' });
```

---

## 8. Events

Event handlers receive the typed payload **directly**. There is no required `{ data: ... }` wrapper for modern typed subscriptions.

```typescript
talox.on('navigation', (event) => console.log(event.url));
talox.on('consoleError', (event) => console.log(event.error));
talox.on('adapted', (event) => console.log(event.reason, event.strategy));
talox.on('bugDetected', (bug) => console.log(bug.description));
```

`AdaptationEngine` is an always-on outcome-feedback loop. The `adapted` event is not a separate smart-mode-only contract.

See `src/types/events.ts` for the exhaustive event map.

---

## 9. Function-calling and MCP contracts

Talox exposes two intentionally different agent-tool surfaces.

### Function calling

`getTaloxTools()` returns controller-aligned function schemas for direct model integrations. The schemas must not advertise arguments the corresponding controller method cannot execute.

### MCP

`talox mcp` exposes a smaller persistent-session stdio tool surface: launch, navigate, click, type, state, screenshot, and stop.

MCP `serverInfo.version` is derived from the installed package's `package.json`, so protocol metadata follows the release version automatically.

Do not assume the MCP tool list and `getTaloxTools()` are identical.

---

## 10. Contract checklist for contributors

Before merging a public API change:

1. Update the TypeScript source contract.
2. Update JSON Schema when `TaloxPageState` changes.
3. Add or update unit/schema tests.
4. Update `getTaloxTools()` if a controller-facing function contract changed.
5. Update MCP only if that operation belongs in its intentionally smaller tool surface.
6. Update copy-paste examples and keep `npm run typecheck:examples` green.
7. Update README / `llms.txt` / this document when public usage changes.
8. Keep `npm run test:package` green so packed exports, CLI, declarations, and MCP metadata remain installable and coherent.

Talox v9 requires Node.js 20+.
