import type { TaloxPageState, TaloxBug, TaloxNode } from '../types/index.js';

export class RulesEngine {
  /**
   * 🔍 STRUCTURAL DIFFING: Detect changes in AX-Tree or DOM between two states.
   */
  diffStructural(oldState: TaloxPageState, newState: TaloxPageState): TaloxBug[] {
    const bugs: TaloxBug[] = [];
    
    // 1. AX-Tree Diffing
    const oldNodes = new Map(oldState.nodes.map(n => [n.id, n]));
    const newNodes = new Map(newState.nodes.map(n => [n.id, n]));

    for (const [id, oldNode] of oldNodes) {
        if (!newNodes.has(id)) {
            bugs.push({
                id: `structural-missing-${id}-${Date.now()}`,
                type: 'STRUCTURAL_REGRESSION',
                severity: 'MAJOR',
                description: `Node '${oldNode.role}' with name '${oldNode.name}' is missing in the new state.`,
                evidence: { oldNode }
            });
        }
    }

    // 2. DOM-based Interactive Elements Diffing (Fallback/Bonus)
    const oldInteractive = new Map(oldState.interactiveElements.map(e => [e.id, e]));
    const newInteractive = new Map(newState.interactiveElements.map(e => [e.id, e]));

    for (const [id, oldEl] of oldInteractive) {
        if (!newInteractive.has(id)) {
            bugs.push({
                id: `dom-missing-${id}-${Date.now()}`,
                type: 'STRUCTURAL_REGRESSION',
                severity: 'MAJOR',
                description: `Interactive element '${oldEl.tagName}' is missing in the new state.`,
                evidence: { oldEl }
            });
        }
    }

    return bugs;
  }

  analyze(state: TaloxPageState): TaloxBug[] {
    const bugs: TaloxBug[] = [];

    // 1. JS Error Rule
    for (const error of state.console.errors) {
      bugs.push({
        id: `js-error-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        type: 'JS_ERROR',
        severity: 'CRITICAL',
        description: `Console error detected: ${error}`,
        evidence: { error },
      });
    }

    // 2. Overlap Detection (Refined with tolerance)
    const elements = state.interactiveElements;
    for (let i = 0; i < elements.length; i++) {
        const elA = elements[i];
        if (!elA) continue;

        for (let j = i + 1; j < elements.length; j++) {
            const elB = elements[j];
            if (!elB) continue;

            const a = elA.boundingBox;
            const b = elB.boundingBox;

            const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
            const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
            const overlapArea = overlapX * overlapY;
            
            const areaA = a.width * a.height;
            const areaB = b.width * b.height;

            // If overlap is more than 30% of either element (Tighter threshold)
            if (overlapArea > Math.min(areaA, areaB) * 0.3 && areaA > 0 && areaB > 0) {
                bugs.push({
                    id: `overlap-${Date.now()}-${i}-${j}`,
                    type: 'VISUAL_OVERLAP',
                    severity: 'MAJOR',
                    description: `Elements '${elA.tagName}' and '${elB.tagName}' overlap significantly.`,
                    evidence: { el1: elA, el2: elB, overlapArea }
                });
            }
        }
    }

    // 3. Clipping Detection (Dynamic Viewport)
    // In a real scenario, the viewport should be passed from PageStateCollector
    const viewport = { width: 1280, height: 720 }; 
    for (const el of elements) {
        const box = el.boundingBox;
        const isClipped = box.x < -1 || box.y < -1 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1;
        
        if (isClipped) {
            bugs.push({
                id: `clipping-${Date.now()}-${el.id}`,
                type: 'VISUAL_CLIPPING',
                severity: 'MINOR',
                description: `Element '${el.tagName}' is partially outside the viewport.`,
                evidence: { el, box, viewport }
            });
        }
    }

    return bugs;
  }
}
