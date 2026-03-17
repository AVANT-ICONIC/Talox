export type ProfileClass = 'qa' | 'ops' | 'sandbox';
export type TaloxMode = 'speed' | 'stealth' | 'balanced' | 'qa' | 'debug' | 'browse' | 'hybrid';

export interface TaloxSettings {
  mouseSpeed: number; // 0.1 to 2.0 (1.0 default)
  typingDelayMin: number;
  typingDelayMax: number;
  stealthLevel: 'low' | 'medium' | 'high';
  perceptionDepth: 'shallow' | 'full';
  fidgetEnabled: boolean;
  humanStealth: number; // 0.0 to 1.0
  typoProbability: number; // 0.0 to 1.0 - probability of typo per character
  adaptiveStealthEnabled: boolean; // Enable viewport adaptive stealth
  adaptiveStealthSensitivity: number; // 0.1 to 2.0 - sensitivity of density calculation
  adaptiveStealthRadius: number; // pixel radius for density calculation
  precisionDecay: number; // 0.0 = perfect precision, 1.0 = maximum decay
  automaticThinkingEnabled: boolean; // Enable automatic thinking behaviors during idle
  idleTimeout: number; // ms to wait before triggering thinking behaviors
}

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
}

export interface TaloxProfile {
  id: string;
  class: ProfileClass;
  purpose: string;
  userDataDir: string;
  metadata: {
    createdAt: string;
    lastUsed: string;
  };
}

export interface TaloxBug {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  description: string;
  evidence: any;
}

export interface VisualDiffResult {
  mismatchedPixels: number;
  ssimScore: number;
  ocrText?: string;
  diffImageUrl?: string;
}

export interface TaloxPageState {
  url: string;
  title: string;
  timestamp: string;
  mode: TaloxMode;
  console: { errors: string[] };
  network: { failedRequests: Array<{ url: string; status: number }> };
  nodes: TaloxNode[];
  interactiveElements: Array<{ id: string; tagName: string; boundingBox: { x: number; y: number; width: number; height: number } }>;
  bugs: TaloxBug[];
}
