# TALOX-CONTRACTS.md - Data Models & Schemas

## 1. Page State Object (`TaloxPageState`)
The primary object returned to agents, representing the fused state of the page.

```typescript
interface TaloxPageState {
  url: string;
  title: string;
  timestamp: string;
  profileId: string;
  mode: TaloxMode;

  console: {
    errors: string[];
    warnings: string[];
    logs: string[];
  };
  network: {
    failedRequests: Array<{ url: string; status: number; type: string }>;
    exceptions: any[];
  };

  axTree: any; // Minified accessibility tree
  interactiveElements: Array<{
    id: string;
    tagName: string;
    role: string;
    text: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    isActionable: boolean;
  }>;

  bugs: TaloxBug[];
  screenshots: {
    fullPage?: string;
    crops: Array<{ id: string; path: string; reason: string }>;
  };
}
```

## 2. Bug Object (`TaloxBug`)

```typescript
interface TaloxBug {
  id: string;
  type: 'JS_ERROR' | 'NETWORK_FAILURE' | 'LAYOUT_OVERLAP' | 'CLIPPED_ELEMENT' | 'INVISIBLE_CTA' | 'VISUAL_REGRESSION';
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  confidence: number; // 0.0 - 1.0
  description: string;
  reproductionSteps: string[];
  evidence: {
    url: string;
    profile: string;
    consoleLog?: string;
    networkLog?: string;
    screenshotRef?: string;
    cropRef?: string;
  };
  metadata?: Record<string, any>;
}
```

## 3. Profile Schema (`TaloxProfile`)

```typescript
interface TaloxProfile {
  id: string;
  class: 'qa' | 'ops' | 'sandbox';
  purpose: string;
  userDataDir: string;
  policy: {
    allowedDomains: string[];
    blockedActions: string[];
    extensions: string[];
  };
  metadata: {
    createdAt: string;
    lastUsed: string;
    tags: string[];
  };
}
```

## 4. TaloxSettings
Runtime behavioral parameters controlling agent execution.

```typescript
interface TaloxSettings {
  mode: TaloxMode;
  mouseSpeed: number;
  typingDelayMin: number;
  typingDelayMax: number;
  stealthLevel: 'low' | 'medium' | 'high';
  perceptionDepth: 'shallow' | 'full';
  fidgetEnabled: boolean;
  humanStealth: number; // 0.0 to 1.0
  typoProbability: number;
  adaptiveStealthEnabled: boolean;
  precisionDecay: number;
  automaticThinkingEnabled: boolean;
  idleTimeout: number;
}
```

## 5. BehavioralDNA
Profile-specific interaction fingerprint.

```typescript
interface BehavioralDNA {
  profileId: string;
  typeBehavior: {
    avgTypingSpeed: number; // chars per second
    errorRate: number;
    pauseBetweenWords: number;
  };
  clickPattern: {
    doubleClickProbability: number;
    hoverDuration: number;
  };
  timingVariance: {
    actionDelayMin: number;
    actionDelayMax: number;
  };
}
```

## 6. VisualDiffResult

```typescript
interface VisualDiffResult {
  testId: string;
  timestamp: string;
  passed: boolean;
  baselinePath: string;
  currentPath: string;
  diffPath?: string;
  similarity: number; // 0.0 - 1.0
  diffPixelCount: number;
  diffRegions: Array<{ x: number; y: number; width: number; height: number }>;
}
```

## 7. Agent Control API Commands

| Command | Payload | Description |
| :--- | :--- | :--- |
| `launch` | `{ profileId: string }` | Launches the browser with a specific profile. |
| `navigate` | `{ url: string }` | Navigates to a URL. |
| `getState` | `{}` | Returns the current `TaloxPageState`. |
| `click` | `{ selector?: string, x?: number, y?: number }` | Clicks an element or coordinate. |
| `type` | `{ text: string, selector?: string }` | Types text into an element. |
| `press` | `{ key: string }` | Presses a key (e.g., 'Enter', 'Escape'). |
| `screenshot` | `{ full?: boolean }` | Captures a screenshot. |
| `setMode` | `{ mode: TaloxMode }` | Sets the execution mode. |
| `override` | `{ setting: string, value: any }` | Overrides a runtime setting. |
| `findNodeByText` | `{ text: string, role?: string }` | Finds accessibility node by text. |
| `findNodeByRole` | `{ role: string, name?: string }` | Finds accessibility node by role. |
| `verifyVisual` | `{ baselinePath: string, threshold?: number }` | Visual regression check. |
| `stop` | `{}` | Closes the browser and cleans up. |
