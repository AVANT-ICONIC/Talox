import type { TaloxNode } from '../types/index.js';

export interface SuccessState {
  originalSelector: string;
  matchedNode: TaloxNode;
  timestamp: string;
  context: {
    parentRole?: string | undefined;
    parentName?: string | undefined;
    siblingCount: number;
  };
}

export interface FallbackResult {
  selector: string;
  confidence: number;
  strategy: 'role' | 'name-similarity' | 'position' | 'context' | 'combined';
  matchedNode: TaloxNode;
}

export interface SelectorHealingOptions {
  enableRoleMatch: boolean;
  enableNameSimilarity: boolean;
  enablePositionMatch: boolean;
  enableContextMatch: boolean;
  nameSimilarityThreshold: number;
  positionTolerance: number;
}

const DEFAULT_OPTIONS: SelectorHealingOptions = {
  enableRoleMatch: true,
  enableNameSimilarity: true,
  enablePositionMatch: true,
  enableContextMatch: true,
  nameSimilarityThreshold: 0.6,
  positionTolerance: 50,
};

export class SelfHealingSelector {
  private successStates: Map<string, SuccessState[]> = new Map();
  private historicalSnapshots: TaloxNode[][] = [];
  private maxSnapshots: number = 10;
  private maxStatesPerSelector: number = 5;

  constructor(private options: Partial<SelectorHealingOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  recordSuccess(selector: string, node: TaloxNode, parentNode?: TaloxNode): void {
    const context = this.extractContext(node, parentNode);
    const state: SuccessState = {
      originalSelector: selector,
      matchedNode: node,
      timestamp: new Date().toISOString(),
      context,
    };

    const existing = this.successStates.get(selector) || [];
    existing.unshift(state);
    if (existing.length > this.maxStatesPerSelector) {
      existing.pop();
    }
    this.successStates.set(selector, existing);
  }

  recordSnapshot(nodes: TaloxNode[]): void {
    this.historicalSnapshots.unshift([...nodes]);
    if (this.historicalSnapshots.length > this.maxSnapshots) {
      this.historicalSnapshots.pop();
    }
  }

  async heal(
    failedSelector: string,
    currentNodes: TaloxNode[]
  ): Promise<FallbackResult | null> {
    const states = this.successStates.get(failedSelector);
    if (!states || states.length === 0) {
      return null;
    }

    const results: FallbackResult[] = [];

    for (const state of states) {
      const roleResult = this.matchByRole(state, currentNodes);
      if (roleResult) results.push(roleResult);

      const nameResult = this.matchByNameSimilarity(state, currentNodes);
      if (nameResult) results.push(nameResult);

      const positionResult = this.matchByPosition(state, currentNodes);
      if (positionResult) results.push(positionResult);

      const contextResult = this.matchByContext(state, currentNodes);
      if (contextResult) results.push(contextResult);
    }

    const combinedResult = this.combineResults(results);
    if (combinedResult && combinedResult.confidence >= 0.3) {
      return combinedResult;
    }

    return null;
  }

  private extractContext(node: TaloxNode, parentNode?: TaloxNode): SuccessState['context'] {
    return {
      parentRole: parentNode?.role ?? undefined,
      parentName: parentNode?.name ?? undefined,
      siblingCount: 0,
    };
  }

  private matchByRole(state: SuccessState, nodes: TaloxNode[]): FallbackResult | null {
    if (!this.options.enableRoleMatch) return null;

    const targetRole = state.matchedNode.role;
    const matches = nodes.filter(n => n.role === targetRole);

    if (matches.length === 0) return null;

    const exactMatch = matches.find(n => n.name === state.matchedNode.name);
    if (exactMatch) {
      return {
        selector: `[role="${targetRole}"][name="${exactMatch.name}"]`,
        confidence: 0.9,
        strategy: 'role',
        matchedNode: exactMatch,
      };
    }

    const firstMatch = matches[0];
    if (!firstMatch) return null;

    return {
      selector: `[role="${targetRole}"]`,
      confidence: 0.5,
      strategy: 'role',
      matchedNode: firstMatch,
    };
  }

  private matchByNameSimilarity(state: SuccessState, nodes: TaloxNode[]): FallbackResult | null {
    if (!this.options.enableNameSimilarity) return null;

    const targetName = state.matchedNode.name.toLowerCase().trim();
    if (!targetName) return null;

    let bestMatch: TaloxNode | null = null;
    let bestScore = 0;

    for (const node of nodes) {
      const nodeName = node.name.toLowerCase().trim();
      if (!nodeName) continue;

      const score = this.calculateSimilarity(targetName, nodeName);
      if (score > bestScore && score >= this.options.nameSimilarityThreshold!) {
        bestScore = score;
        bestMatch = node;
      }
    }

    if (bestMatch) {
      return {
        selector: `[name*="${this.escapeSelectorPart(bestMatch.name)}"]`,
        confidence: bestScore,
        strategy: 'name-similarity',
        matchedNode: bestMatch,
      };
    }

    return null;
  }

  private matchByPosition(state: SuccessState, nodes: TaloxNode[]): FallbackResult | null {
    if (!this.options.enablePositionMatch) return null;

    const targetBox = state.matchedNode.boundingBox;
    const tolerance = this.options.positionTolerance!;

    let bestMatch: TaloxNode | null = null;
    let bestDistance = Infinity;

    for (const node of nodes) {
      const nodeBox = node.boundingBox;
      const distance = Math.sqrt(
        Math.pow(nodeBox.x - targetBox.x, 2) + Math.pow(nodeBox.y - targetBox.y, 2)
      );

      if (distance < bestDistance && distance <= tolerance) {
        bestDistance = distance;
        bestMatch = node;
      }
    }

    if (bestMatch) {
      const confidence = 1 - (bestDistance / tolerance);
      return {
        selector: `xpath=//*[contains(@BoundingBox,"${Math.round(bestMatch.boundingBox.x)}")]`,
        confidence,
        strategy: 'position',
        matchedNode: bestMatch,
      };
    }

    return null;
  }

  private matchByContext(state: SuccessState, nodes: TaloxNode[]): FallbackResult | null {
    if (!this.options.enableContextMatch) return null;

    const context = state.context;
    if (!context.parentRole && !context.parentName) return null;

    for (const node of nodes) {
      if (context.parentRole && node.role === context.parentRole) {
        if (!context.parentName || node.name.includes(context.parentName)) {
          return {
            selector: `[role="${context.parentRole}"] [role="${state.matchedNode.role}"]`,
            confidence: 0.7,
            strategy: 'context',
            matchedNode: node,
          };
        }
      }
    }

    return null;
  }

  private combineResults(results: FallbackResult[]): FallbackResult | null {
    if (results.length === 0) return null;

    const nodeGroups = new Map<string, FallbackResult[]>();
    for (const result of results) {
      const key = result.matchedNode.id;
      const existing = nodeGroups.get(key) || [];
      existing.push(result);
      nodeGroups.set(key, existing);
    }

    let bestCombined: FallbackResult | null = null;
    let bestWeightedScore = 0;

    for (const [_, group] of nodeGroups) {
      const weights: Record<FallbackResult['strategy'], number> = {
        role: 0.3,
        'name-similarity': 0.4,
        position: 0.2,
        context: 0.25,
        combined: 0.5,
      };

      let weightedScore = 0;
      for (const result of group) {
        weightedScore += result.confidence * (weights[result.strategy] || 0.1);
      }
      weightedScore /= group.length;

      if (weightedScore > bestWeightedScore) {
        const firstResult = group[0];
        if (!firstResult) continue;
        bestWeightedScore = weightedScore;
        bestCombined = {
          selector: firstResult.selector,
          confidence: weightedScore,
          strategy: 'combined' as const,
          matchedNode: firstResult.matchedNode,
        };
      }
    }

    return bestCombined;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const m = s1.length;
    const n = s2.length;
    
    if (m === 0) return n;
    if (n === 0) return m;

    let prevRow: number[] = [];
    let currRow: number[] = [];

    for (let j = 0; j <= m; j++) {
      prevRow[j] = j;
    }

    for (let i = 1; i <= n; i++) {
      currRow = [i];
      for (let j = 1; j <= m; j++) {
        const cost = s2.charAt(i - 1) === s1.charAt(j - 1) ? 0 : 1;
        const a = prevRow[j]! + 1;
        const b = currRow[j - 1]! + 1;
        const c = prevRow[j - 1]! + cost;
        currRow[j] = Math.min(a, b, c);
      }
      const temp = prevRow;
      prevRow = currRow;
      temp.length = 0;
    }

    return prevRow[m]!;
  }

  private escapeSelectorPart(str: string): string {
    return str.replace(/["\\]/g, '\\$&');
  }

  getSuccessStates(selector: string): SuccessState[] {
    return this.successStates.get(selector) || [];
  }

  clearHistory(): void {
    this.successStates.clear();
    this.historicalSnapshots = [];
  }

  setOption<K extends keyof SelectorHealingOptions>(
    key: K,
    value: SelectorHealingOptions[K]
  ): void {
    (this.options as any)[key] = value;
  }

  getOptions(): SelectorHealingOptions {
    return { ...DEFAULT_OPTIONS, ...this.options };
  }
}
