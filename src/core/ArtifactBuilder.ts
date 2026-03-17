export interface VisualContext {
  mouseX?: number;
  mouseY?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollPosition?: number;
}

export interface ActionFrame {
  frameIndex: number;
  timestamp: string;
  relativeTimeMs: number;
  durationMs?: number;
  type: string;
  action: string;
  details: Record<string, any>;
  visualContext?: VisualContext;
}

export interface ExportOptions {
  includeVisualContext?: boolean;
  includePayloads?: boolean;
  prettyPrint?: boolean;
}

interface StoredAction {
  type: string;
  payload: any;
  timestamp: string;
  durationMs?: number;
  visualContext?: VisualContext;
}

export class ArtifactBuilder {
  private actions: StoredAction[] = [];
  private startTime: number = Date.now();

  addAction(type: string, payload: any, durationMs?: number, visualContext?: VisualContext) {
    const action: StoredAction = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    if (durationMs !== undefined) {
      action.durationMs = durationMs;
    }
    if (visualContext !== undefined) {
      action.visualContext = visualContext;
    }
    this.actions.push(action);
  }

  addMousePosition(mouseX: number, mouseY: number, viewportWidth?: number, viewportHeight?: number) {
    const lastAction = this.actions[this.actions.length - 1];
    if (lastAction) {
      const vc: VisualContext = {
        mouseX,
        mouseY,
      };
      if (viewportWidth !== undefined) {
        vc.viewportWidth = viewportWidth;
      }
      if (viewportHeight !== undefined) {
        vc.viewportHeight = viewportHeight;
      }
      lastAction.visualContext = {
        ...lastAction.visualContext,
        ...vc,
      };
    }
  }

  addScrollPosition(scrollPosition: number) {
    const lastAction = this.actions[this.actions.length - 1];
    if (lastAction) {
      lastAction.visualContext = {
        ...lastAction.visualContext,
        scrollPosition,
      };
    }
  }

  getTrace() {
    return {
      id: `trace-${Date.now()}`,
      actions: [...this.actions],
    };
  }

  private getRelativeTime(timestamp: string): number {
    return new Date(timestamp).getTime() - this.startTime;
  }

  toActionFrames(): ActionFrame[] {
    return this.actions.map((action, index) => {
      const frame: ActionFrame = {
        frameIndex: index,
        timestamp: action.timestamp,
        relativeTimeMs: this.getRelativeTime(action.timestamp),
        type: action.type,
        action: this.formatActionType(action.type),
        details: this.sanitizePayload(action.payload),
      };
      
      if (action.durationMs !== undefined) {
        frame.durationMs = action.durationMs;
      }
      
      if (action.visualContext && Object.keys(action.visualContext).length > 0) {
        frame.visualContext = action.visualContext;
      }
      
      return frame;
    });
  }

  private formatActionType(type: string): string {
    const typeMap: Record<string, string> = {
      'CLICK': 'Click Action',
      'INPUT': 'Input Action',
      'NAVIGATE': 'Navigation Action',
      'SCROLL': 'Scroll Action',
      'WAIT': 'Wait Action',
      'SCRIPT': 'Script Execution',
      'EVALUATE': 'Evaluate Expression',
      'SELECT': 'Select Element',
      'HOVER': 'Hover Action',
      'KEYPRESS': 'Key Press',
      'SUBMIT': 'Form Submit',
      'CHANGE': 'Value Change',
      'GOTO': 'Navigate to URL',
      'BACK': 'Navigate Back',
      'FORWARD': 'Navigate Forward',
      'REFRESH': 'Refresh Page',
    };
    return typeMap[type] || type;
  }

  private sanitizePayload(payload: any): Record<string, any> {
    if (!payload) return {};
    
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'authorization', 'cookie'];
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  exportAsJSON(options: ExportOptions = {}): string {
    const { includeVisualContext = true, includePayloads = true, prettyPrint = true } = options;
    
    const frames = this.toActionFrames().map(frame => {
      const exportFrame: Record<string, any> = {
        frameIndex: frame.frameIndex,
        timestamp: frame.timestamp,
        relativeTimeMs: frame.relativeTimeMs,
        type: frame.type,
        action: frame.action,
      };
      
      if (frame.durationMs !== undefined) {
        exportFrame.durationMs = frame.durationMs;
      }
      
      if (includePayloads) {
        exportFrame.details = frame.details;
      }
      
      if (includeVisualContext && frame.visualContext) {
        exportFrame.visualContext = frame.visualContext;
      }
      
      return exportFrame;
    });

    const endTimestamp = this.actions.length > 0 
      ? this.actions[this.actions.length - 1]?.timestamp 
      : new Date().toISOString();

    const exportData = {
      sessionId: `session-${this.startTime}`,
      exportedAt: new Date().toISOString(),
      totalFrames: frames.length,
      startTime: new Date(this.startTime).toISOString(),
      endTime: endTimestamp,
      frames,
    };

    return prettyPrint ? JSON.stringify(exportData, null, 2) : JSON.stringify(exportData);
  }

  exportAsText(options: ExportOptions = {}): string {
    const { includeVisualContext = true, includePayloads = true } = options;
    const frames = this.toActionFrames();
    
    const lines: string[] = [
      '='.repeat(80),
      'GHOST REPLAY SESSION LOG',
      '='.repeat(80),
      `Session ID: session-${this.startTime}`,
      `Exported: ${new Date().toISOString()}`,
      `Total Actions: ${frames.length}`,
      `Start Time: ${new Date(this.startTime).toISOString()}`,
      '─'.repeat(80),
      '',
    ];

    frames.forEach((frame) => {
      const timeStr = `${(frame.relativeTimeMs / 1000).toFixed(3)}s`;
      const durationStr = frame.durationMs ? ` [${frame.durationMs}ms]` : '';
      
      lines.push(`[Frame ${frame.frameIndex}] ${timeStr}${durationStr} | ${frame.action}`);
      lines.push(`  Type: ${frame.type}`);
      
      if (includePayloads && Object.keys(frame.details).length > 0) {
        lines.push('  Details:');
        for (const [key, value] of Object.entries(frame.details)) {
          lines.push(`    ${key}: ${JSON.stringify(value)}`);
        }
      }
      
      if (includeVisualContext && frame.visualContext) {
        const vc = frame.visualContext;
        const posParts: string[] = [];
        if (vc.mouseX !== undefined && vc.mouseY !== undefined) {
          posParts.push(`Mouse: (${vc.mouseX}, ${vc.mouseY})`);
        }
        if (vc.viewportWidth !== undefined && vc.viewportHeight !== undefined) {
          posParts.push(`Viewport: ${vc.viewportWidth}x${vc.viewportHeight}`);
        }
        if (vc.scrollPosition !== undefined) {
          posParts.push(`Scroll: ${vc.scrollPosition}`);
        }
        if (posParts.length > 0) {
          lines.push(`  Visual: ${posParts.join(' | ')}`);
        }
      }
      
      lines.push('');
    });

    lines.push('─'.repeat(80));
    const totalDuration = ((Date.now() - this.startTime) / 1000).toFixed(3);
    lines.push(`End of Session | Total Duration: ${totalDuration}s`);
    lines.push('='.repeat(80));

    return lines.join('\n');
  }

  exportAsActionFrames(options: ExportOptions = {}): string {
    const { includeVisualContext = true, includePayloads = true, prettyPrint = true } = options;
    
    const frames = this.toActionFrames().map(frame => {
      const exportFrame: Record<string, any> = {
        frameIndex: frame.frameIndex,
        timestamp: frame.timestamp,
        relativeTimeMs: frame.relativeTimeMs,
        type: frame.type,
        action: frame.action,
      };
      
      if (frame.durationMs !== undefined) {
        exportFrame.durationMs = frame.durationMs;
      }
      
      if (includePayloads) {
        exportFrame.details = frame.details;
      }
      
      if (includeVisualContext && frame.visualContext) {
        exportFrame.visualContext = frame.visualContext;
      }
      
      return exportFrame;
    });

    return prettyPrint ? JSON.stringify(frames, null, 2) : JSON.stringify(frames);
  }

  getSessionSummary(): {
    sessionId: string;
    startTime: string;
    endTime: string;
    totalDurationMs: number;
    totalActions: number;
    actionTypes: Record<string, number>;
    hasVisualContext: boolean;
  } {
    const actionTypes: Record<string, number> = {};
    let hasVisualContext = false;

    this.actions.forEach(action => {
      actionTypes[action.type] = (actionTypes[action.type] || 0) + 1;
      if (action.visualContext && Object.keys(action.visualContext).length > 0) {
        hasVisualContext = true;
      }
    });

    const lastAction = this.actions[this.actions.length - 1];
    const endTime = lastAction ? new Date(lastAction.timestamp).getTime() : Date.now();

    return {
      sessionId: `session-${this.startTime}`,
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      totalDurationMs: endTime - this.startTime,
      totalActions: this.actions.length,
      actionTypes,
      hasVisualContext,
    };
  }

  clear() {
    this.actions = [];
    this.startTime = Date.now();
  }
}
