import type { TaloxNode, TaloxPageState } from '../types/index.js';

export type ChangeType = 'added' | 'removed' | 'moved' | 'changed';

export interface AXTreeChange {
  type: ChangeType;
  nodeId: string;
  role: string;
  name: string;
  description: string;
  previousPosition?: { x: number; y: number };
  currentPosition?: { x: number; y: number };
  previousValue?: string;
  currentValue?: string;
}

export interface AXTreeDiffResult {
  changes: AXTreeChange[];
  summary: string;
}

export class AXTreeDiffer {
  private computeDistance(
    pos1: { x: number; y: number },
    pos2: { x: number; y: number }
  ): number {
    return Math.sqrt(
      Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2)
    );
  }

  private getNodeMap(nodes: TaloxNode[]): Map<string, TaloxNode> {
    const map = new Map<string, TaloxNode>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }

  private getPositionKey(node: TaloxNode): string {
    const box = node.boundingBox;
    return `${Math.floor(box.x / 50)}-${Math.floor(box.y / 50)}`;
  }

  private findMatchingNode(
    node: TaloxNode,
    previousNodes: TaloxNode[],
    usedIds: Set<string>
  ): TaloxNode | null {
    for (const prevNode of previousNodes) {
      if (usedIds.has(prevNode.id)) continue;
      if (prevNode.role === node.role && prevNode.name === node.name) {
        return prevNode;
      }
    }
    return null;
  }

  diff(before: TaloxPageState, after: TaloxPageState): AXTreeDiffResult {
    const changes: AXTreeChange[] = [];
    const beforeMap = this.getNodeMap(before.nodes);
    const afterMap = this.getNodeMap(after.nodes);
    const matchedIds = new Set<string>();

    for (const afterNode of after.nodes) {
      const beforeNode = beforeMap.get(afterNode.id);

      if (!beforeNode) {
        changes.push({
          type: 'added',
          nodeId: afterNode.id,
          role: afterNode.role,
          name: afterNode.name,
          description: `"${afterNode.name}" (${afterNode.role}) appeared`,
          currentPosition: afterNode.boundingBox,
        });
        continue;
      }

      matchedIds.add(afterNode.id);

      const beforePos = beforeNode.boundingBox;
      const afterPos = afterNode.boundingBox;
      const distance = this.computeDistance(
        { x: beforePos.x, y: beforePos.y },
        { x: afterPos.x, y: afterPos.y }
      );

      if (distance > 30) {
        const direction = this.getMovementDirection(beforePos, afterPos);
        changes.push({
          type: 'moved',
          nodeId: afterNode.id,
          role: afterNode.role,
          name: afterNode.name,
          description: `"${afterNode.name}" moved ${direction}`,
          previousPosition: beforePos,
          currentPosition: afterPos,
        });
      }

      if (beforeNode.name !== afterNode.name) {
        changes.push({
          type: 'changed',
          nodeId: afterNode.id,
          role: afterNode.role,
          name: afterNode.name,
          description: `Text in "${afterNode.role}" changed from "${beforeNode.name}" to "${afterNode.name}"`,
          previousValue: beforeNode.name,
          currentValue: afterNode.name,
        });
      }

      if (
        beforeNode.attributes &&
        afterNode.attributes &&
        JSON.stringify(beforeNode.attributes) !== JSON.stringify(afterNode.attributes)
      ) {
        const changedAttrs = this.getChangedAttributes(
          beforeNode.attributes,
          afterNode.attributes
        );
        if (changedAttrs.length > 0) {
          changes.push({
            type: 'changed',
            nodeId: afterNode.id,
            role: afterNode.role,
            name: afterNode.name,
            description: `Attributes of "${afterNode.name}" changed: ${changedAttrs.join(', ')}`,
          });
        }
      }
    }

    for (const beforeNode of before.nodes) {
      if (!afterMap.has(beforeNode.id) && !matchedIds.has(beforeNode.id)) {
        changes.push({
          type: 'removed',
          nodeId: beforeNode.id,
          role: beforeNode.role,
          name: beforeNode.name,
          description: `"${beforeNode.name}" (${beforeNode.role}) disappeared`,
          previousPosition: beforeNode.boundingBox,
        });
      }
    }

    const summary = this.generateSummary(changes);
    return { changes, summary };
  }

  private getMovementDirection(
    before: { x: number; y: number; width: number; height: number },
    after: { x: number; y: number; width: number; height: number }
  ): string {
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const threshold = 20;

    const directions: string[] = [];
    if (Math.abs(dx) > threshold) {
      directions.push(dx > 0 ? 'right' : 'left');
    }
    if (Math.abs(dy) > threshold) {
      directions.push(dy > 0 ? 'down' : 'up');
    }

    if (directions.length === 0) return 'slightly';
    return directions.join(' ');
  }

  private getChangedAttributes(
    before: Record<string, string | boolean>,
    after: Record<string, string | boolean>
  ): string[] {
    const changed: string[] = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      if (before[key] !== after[key]) {
        changed.push(`${key}: ${before[key]} → ${after[key]}`);
      }
    }

    return changed;
  }

  private generateSummary(changes: AXTreeChange[]): string {
    const added = changes.filter(c => c.type === 'added').length;
    const removed = changes.filter(c => c.type === 'removed').length;
    const moved = changes.filter(c => c.type === 'moved').length;
    const changed = changes.filter(c => c.type === 'changed').length;

    const parts: string[] = [];
    if (added > 0) parts.push(`${added} added`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (moved > 0) parts.push(`${moved} moved`);
    if (changed > 0) parts.push(`${changed} changed`);

    if (parts.length === 0) return 'No changes detected';

    return parts.join(', ') + '.';
  }
}
