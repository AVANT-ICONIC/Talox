# TALOX-CONTRACTS.md - Data Models & Schemas

> **Source of truth:** `src/types/index.ts` and `src/schema/TaloxPageState.schema.json`

## 1. Page State Object (`TaloxPageState`)

The primary object returned to agents after every `navigate()` or `getState()` call.

```typescript
interface TaloxPageState {
  url: string;
  title: string;
  timestamp: string;         // ISO 8601
  profileId?: string;
  mode: TaloxMode;

  console: {
    errors: string[];        // console.error() messages
    warnings?: string[];     // console.warn() messages
    logs?: string[];         // console.log() messages
  };

  network: {
    failedRequests: Array<{ url: string; status: number; type?: string }>;
    exceptions?: any[];      // CDP Runtime exceptions
  };

  axTree?: TaloxNode;        // Full AX-Tree root. Only present when perceptionDepth = 'full'
  nodes: TaloxNode[];        // Flat list of all AX nodes

  interactiveElements: Array<{
    id: string;
    tagName: string;         // HTML tag: 'button', 'input', 'a', etc.
    role?: string;           // ARIA role
    text?: string;           // Visible text content
    boundingBox: { x: number; y: number; width: number; height: number };
    isActionable?: boolean;  // false if element is disabled, hidden, or pointer-events: none
  }>;

  bugs: TaloxBug[];

  screenshots?: {
    fullPage?: string;       // Path to full-page screenshot
    crops?: Array<{ id: string; path: string; reason: string }>;
  };
}
```

### perceptionDepth

| Value | `nodes` | `axTree` | Token cost |
| :--- | :--- | :--- | :--- |
| `shallow` | Empty array | Not present | Minimal — interactive elements only |
| `full` | All AX nodes | Root node present | Full — use for deep analysis |

---

## 2. Bug Object (`TaloxBug`)

```typescript
interface TaloxBug {
  id: string;
  type: 'JS_ERROR' | 'NETWORK_FAILURE' | 'LAYOUT_OVERLAP' | 'CLIPPED_ELEMENT' | 'INVISIBLE_CTA' | 'VISUAL_REGRESSION';
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  confidence?: number;       // 0.0 - 1.0
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

## 3. AX Node (`TaloxNode`)

```typescript
interface TaloxNode {
  id: string;
  role: string;              // ARIA role: 'button', 'heading', 'link', 'textbox', etc.
  name: string;              // Accessible name
  description?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  attributes?: Record<string, string | boolean>;
  children?: TaloxNode[];    // Present in axTree, absent in flat nodes array
}
```

---

## 4. Profile Schema (`TaloxProfile`)

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

---

## 5. TaloxSettings

Runtime behavioral parameters. Override any at runtime with `talox.override(param, value)`.

```typescript
interface TaloxSettings {
  mouseSpeed: number;              // 0.1–3.0 (1.0 default)
  typingDelayMin: number;          // ms between keystrokes (min)
  typingDelayMax: number;          // ms between keystrokes (max)
  stealthLevel: 'low' | 'medium' | 'high';
  perceptionDepth: 'shallow' | 'full';
  fidgetEnabled: boolean;
  humanStealth: number;            // 0.0–1.0
  typoProbability: number;         // 0.0–1.0 per character
  adaptiveStealthEnabled: boolean;
  adaptiveStealthSensitivity: number; // 0.1–2.0
  adaptiveStealthRadius: number;   // pixel radius for density calculation
  precisionDecay: number;          // 0.0 = perfect, 1.0 = maximum decay
  automaticThinkingEnabled: boolean;
  idleTimeout: number;             // ms before triggering idle behaviors
}
```

---

## 6. Mode Presets

| Mode | mouseSpeed | humanStealth | adaptiveStealth | typoProbability | perceptionDepth |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `stealth` | 0.7 | 1.0 | enabled | 0.10 | full |
| `debug` | 1.0 | 0.5 | disabled | 0.05 | full |
| `balanced` | 1.0 | 0.5 | enabled | 0.08 | full |
| `browse` | 1.0 | 0.5 | enabled | 0.08 | full |
| `speed` | 3.0 | 0.0 | disabled | 0.00 | shallow |
| `qa` | 1.5 | 0.2 | disabled | 0.00 | full |

---

## 7. BehavioralDNA

Profile-specific interaction fingerprint. Generated deterministically from `profileId`.

```typescript
interface BehavioralDNA {
  profileId?: string;
  jitterFrequency: number;         // 0.0–1.0
  accelerationCurve: 'linear' | 'ease-out' | 'ease-in-out' | 'bezier';
  typingRhythm: 'fast' | 'medium' | 'slow' | 'variable';
  clickPrecision: number;          // 0.0–1.0
  movementStyle: 'smooth' | 'jerky' | 'precise' | 'relaxed';
}
```

---

## 8. VisualDiffResult

```typescript
interface VisualDiffResult {
  testId?: string;
  timestamp?: string;
  passed?: boolean;
  baselinePath?: string;
  currentPath?: string;
  diffPath?: string;
  similarity?: number;             // 0.0–1.0 (SSIM)
  mismatchedPixels: number;
  ssimScore: number;
  ocrText?: string;
  diffImageUrl?: string;
  diffRegions?: Array<{ x: number; y: number; width: number; height: number }>;
}
```

---

## 9. Agent Control API

| Method | Signature | Returns | Description |
| :--- | :--- | :--- | :--- |
| `launch` | `(profileId, class, mode)` | `void` | Launch browser with profile |
| `navigate` | `(url)` | `TaloxPageState` | Navigate and return full state |
| `getState` | `()` | `TaloxPageState` | Capture current state |
| `click` | `({ selector?, x?, y? })` | `void` | Click element or coordinate |
| `type` | `({ text, selector? })` | `void` | Type text with human timing |
| `press` | `({ key })` | `void` | Press a key (e.g. 'Enter') |
| `screenshot` | `({ full? })` | `string` | Capture screenshot, returns path |
| `setMode` | `(mode)` | `void` | Switch execution mode |
| `override` | `(setting, value)` | `void` | Override a runtime setting |
| `findNodeByText` | `(text, role?)` | `TaloxNode \| null` | Find AX node by text |
| `findNodeByRole` | `(role, name?)` | `TaloxNode \| null` | Find AX node by role |
| `verifyVisual` | `({ baselinePath, threshold? })` | `VisualDiffResult` | Visual regression check |
| `loadPolicy` | `(path)` | `void` | Load YAML policy file |
| `openPage` | `(url)` | `string` | Open new page, returns pageId |
| `switchPage` | `(pageId)` | `void` | Switch active page |
| `closePage` | `(pageId)` | `void` | Close a page |
| `stop` | `()` | `void` | Close browser and clean up |
