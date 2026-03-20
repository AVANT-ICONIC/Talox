export type ProfileClass = 'qa' | 'ops' | 'sandbox';

// ─── Config & Settings (v2) ─────────────────────────────────────────────────
export type { TaloxConfig } from './config.js';
export type { TaloxSettings } from './settings.js';
export { DEFAULT_SETTINGS } from './settings.js';

// ─── Event System ─────────────────────────────────────────────────────────────
export type {
  TaloxEventMap,
  TaloxEventType,
  TaloxEvent,
  AdaptedEvent,
  AdaptationReason,
  SessionEndEvent,
  AnnotationAddedEvent,
  AnnotationUndoneEvent,
} from './events.js';

// ─── Annotation Types ─────────────────────────────────────────────────────────
export type {
  AnnotationLabel,
  BuiltInAnnotationLabel,
  AnnotationElement,
  AnnotationEntry,
} from './annotation.js';
export { ANNOTATION_LABEL_EMOJI, getLabelEmoji } from './annotation.js';

// ─── Session Report Types ─────────────────────────────────────────────────────────
export type {
  SessionOutputFormat,
  InteractionType,
  TaloxInteraction,
  TaloxSessionSummary,
  TaloxSessionReport,
  ObserveSessionOptions,
} from './session.js';

// ─── Core Types ─────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
  t?: number;
}

export interface TaloxNode {
  id: string;
  role: string;
  name: string;
  description?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  attributes?: Record<string, string | boolean>;
  children?: TaloxNode[];
}

export interface TaloxProfile {
  id: string;
  class: ProfileClass;
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

export interface TaloxBug {
  id: string;
  type: 'JS_ERROR' | 'NETWORK_FAILURE' | 'LAYOUT_OVERLAP' | 'CLIPPED_ELEMENT' | 'INVISIBLE_CTA' | 'VISUAL_REGRESSION' | string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  confidence?: number; // 0.0 - 1.0
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

export interface VisualDiffResult {
  testId?: string;
  timestamp?: string;
  passed?: boolean;
  baselinePath?: string;
  currentPath?: string;
  diffPath?: string;
  similarity?: number; // 0.0 - 1.0
  mismatchedPixels: number;
  ssimScore: number;
  ocrText?: string;
  diffImageUrl?: string;
  diffRegions?: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface BehavioralDNA {
  profileId?: string;
  jitterFrequency: number;
  accelerationCurve: 'linear' | 'ease-out' | 'ease-in-out' | 'bezier';
  typingRhythm: 'fast' | 'medium' | 'slow' | 'variable';
  clickPrecision: number;
  movementStyle: 'smooth' | 'jerky' | 'precise' | 'relaxed';
  typeBehavior?: {
    avgTypingSpeed: number; // chars per second
    errorRate: number;
    pauseBetweenWords: number;
  };
  clickPattern?: {
    doubleClickProbability: number;
    hoverDuration: number;
  };
  timingVariance?: {
    actionDelayMin: number;
    actionDelayMax: number;
  };
}

export interface TaloxPageState {
  url: string;
  title: string;
  timestamp: string;
  profileId?: string;
  mode?: string;
  console: {
    errors: string[];
    warnings?: string[];
    logs?: string[];
  };
  network: {
    failedRequests: Array<{ url: string; status: number; type?: string }>;
    exceptions?: any[];
  };
  axTree?: TaloxNode; // Full AX-Tree root (perceptionDepth: 'full')
  nodes: TaloxNode[]; // Flat list of all AX nodes
  interactiveElements: Array<{
    id: string;
    tagName: string;
    role?: string;
    text?: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    isActionable?: boolean;
  }>;
  bugs: TaloxBug[];
  screenshots?: {
    fullPage?: string;
    crops?: Array<{ id: string; path: string; reason: string }>;
  };
}
