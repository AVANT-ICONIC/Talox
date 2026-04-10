import type { ActionFrame } from '../core/ArtifactBuilder.js';

export interface EventLogEntry {
  event: string;
  timestamp: string;
  payload?: Record<string, unknown> | undefined;
}

export interface FailureEntry {
  type: 'console' | 'network';
  message: string;
  url?: string;
  status?: number;
  interactionIndex?: number;
}

export interface InteractionDiff {
  interactionIndex: number;
  url: string;
  urlChanged: boolean;
  element?: string;
  notes?: string;
}

export interface BugSummaryEntry {
  id: string;
  type: string;
  severity: string;
  description: string;
  interactionIndex?: number;
  evidence?: string | undefined;
}

export interface ScreenshotDescriptor {
  interactionIndex: number;
  when: 'before' | 'after';
  path: string;
}

export interface SessionReportExtras {
  eventLog?: EventLogEntry[];
  failures?: FailureEntry[];
  diffs?: InteractionDiff[];
  bugs?: BugSummaryEntry[];
  trace?: ActionFrame[];
  screenshots?: ScreenshotDescriptor[];
}
