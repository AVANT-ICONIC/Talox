import { describe, it, expect } from 'vitest';
import { HumanMouse } from '../../src/core/HumanMouse';

describe('HumanMouse', () => {
  it('should generate a path with steps', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 500, y: 500 };
    const path = (HumanMouse as any).generatePath(start, end);
    expect(path.length).toBeGreaterThan(20);
    expect(Math.abs(path[0].x)).toBe(0);
    expect(path[path.length - 1].x).toBe(500);
  });
});