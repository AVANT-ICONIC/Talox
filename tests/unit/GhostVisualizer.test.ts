import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pngjs before importing
vi.mock('pngjs', () => {
  return {
    PNG: class MockPNG {
      width: number;
      height: number;
      data: Uint8Array;
      static sync = {
        read: vi.fn((buf: Buffer) => {
          const png = new MockPNG(100, 100);
          return png;
        }),
        write: vi.fn((png: any) => Buffer.from('fake-png-output')),
      };
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8Array(width * height * 4);
      }
    },
  };
});

vi.mock('fs-extra', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { GhostVisualizer, createGhostVisualizer } from '../../src/core/GhostVisualizer';
import type { ActionFrame } from '../../src/core/GhostVisualizer';

function makeActionFrame(overrides: Partial<ActionFrame> = {}): ActionFrame {
  return {
    frameIndex: 0,
    timestamp: new Date().toISOString(),
    relativeTimeMs: 0,
    type: 'mouse',
    action: 'move',
    details: {},
    ...overrides,
  };
}

describe('GhostVisualizer', () => {
  let viz: GhostVisualizer;

  beforeEach(() => {
    viz = new GhostVisualizer();
  });

  describe('constructor + factory', () => {
    it('creates instance with default options', () => {
      const v = new GhostVisualizer();
      expect(v).toBeInstanceOf(GhostVisualizer);
    });

    it('factory function creates instance', () => {
      const v = createGhostVisualizer({ pathColor: '#00FF00' });
      expect(v).toBeInstanceOf(GhostVisualizer);
    });

    it('merges custom options', () => {
      const v = new GhostVisualizer({ pathColor: '#0000FF', pathWidth: 5 });
      expect(v).toBeInstanceOf(GhostVisualizer);
    });
  });

  describe('getPathStatistics', () => {
    it('returns zeros for empty actions', () => {
      const stats = viz.getPathStatistics([]);
      expect(stats.totalPoints).toBe(0);
      expect(stats.totalDistance).toBe(0);
      expect(stats.averageSpeed).toBe(0);
      expect(stats.startPoint).toBeNull();
      expect(stats.endPoint).toBeNull();
      expect(stats.duration).toBe(0);
    });

    it('computes stats for a single action frame', () => {
      const actions = [makeActionFrame({
        visualContext: { mouseX: 10, mouseY: 20 },
        relativeTimeMs: 100,
      })];
      const stats = viz.getPathStatistics(actions);
      expect(stats.totalPoints).toBe(1);
      expect(stats.totalDistance).toBe(0);
      expect(stats.startPoint).toEqual(expect.objectContaining({ x: 10, y: 20 }));
    });

    it('computes total distance between multiple points', () => {
      const actions = [
        makeActionFrame({
          visualContext: { mouseX: 0, mouseY: 0 },
          relativeTimeMs: 0,
        }),
        makeActionFrame({
          visualContext: { mouseX: 300, mouseY: 400 },
          relativeTimeMs: 1000,
        }),
      ];
      const stats = viz.getPathStatistics(actions);
      expect(stats.totalPoints).toBe(2);
      expect(stats.totalDistance).toBeCloseTo(500);
      expect(stats.duration).toBe(1000);
      expect(stats.averageSpeed).toBeCloseTo(500);
    });

    it('skips frames without visualContext mouse coordinates', () => {
      const actions = [
        makeActionFrame({ visualContext: { scrollPosition: 100 } }),
        makeActionFrame({ visualContext: { mouseX: 50, mouseY: 50 }, relativeTimeMs: 500 }),
      ];
      const stats = viz.getPathStatistics(actions);
      expect(stats.totalPoints).toBe(1);
    });

    it('returns duration=0 when relativeTimeMs is undefined', () => {
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 0, mouseY: 0 } }),
        makeActionFrame({ visualContext: { mouseX: 100, mouseY: 100 } }),
      ];
      const stats = viz.getPathStatistics(actions);
      expect(stats.duration).toBe(0);
      expect(stats.averageSpeed).toBe(0);
    });
  });

  describe('visualize', () => {
    it('returns empty buffer for actions without mouse coordinates', () => {
      const actions = [makeActionFrame({ visualContext: undefined })];
      const result = viz.visualize(actions);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(0);
    });

    it('returns a buffer for actions with mouse coordinates (path style)', () => {
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 10, mouseY: 10 }, relativeTimeMs: 0 }),
        makeActionFrame({ visualContext: { mouseX: 50, mouseY: 50 }, relativeTimeMs: 100 }),
      ];
      const result = viz.visualize(actions);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns a buffer for dots style', () => {
      const v = new GhostVisualizer({ style: 'dots' });
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 10, mouseY: 10 }, relativeTimeMs: 0 }),
      ];
      const result = v.visualize(actions);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('returns a buffer for heatmap style', () => {
      const v = new GhostVisualizer({ style: 'heatmap' });
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 100, mouseY: 100 }, relativeTimeMs: 0 }),
        makeActionFrame({ visualContext: { mouseX: 100, mouseY: 100 }, relativeTimeMs: 100 }),
        makeActionFrame({ visualContext: { mouseX: 102, mouseY: 102 }, relativeTimeMs: 200 }),
      ];
      const result = v.visualize(actions);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('comparePaths', () => {
    it('returns similarity=1 for identical actions', () => {
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 10, mouseY: 20 }, relativeTimeMs: 0 }),
        makeActionFrame({ visualContext: { mouseX: 30, mouseY: 40 }, relativeTimeMs: 500 }),
      ];
      const cmp = viz.comparePaths(actions, actions);
      expect(cmp.distanceDiff).toBe(0);
      expect(cmp.timeDiff).toBe(0);
      expect(cmp.pathSimilarity).toBe(1);
    });

    it('computes distance diff and similarity for different paths', () => {
      const a1 = [
        makeActionFrame({ visualContext: { mouseX: 0, mouseY: 0 }, relativeTimeMs: 0 }),
        makeActionFrame({ visualContext: { mouseX: 100, mouseY: 0 }, relativeTimeMs: 1000 }),
      ];
      const a2 = [
        makeActionFrame({ visualContext: { mouseX: 0, mouseY: 0 }, relativeTimeMs: 0 }),
        makeActionFrame({ visualContext: { mouseX: 200, mouseY: 0 }, relativeTimeMs: 2000 }),
      ];
      const cmp = viz.comparePaths(a1, a2);
      expect(cmp.distanceDiff).toBeCloseTo(100);
      expect(cmp.pathSimilarity).toBeCloseTo(0.5);
      expect(cmp.timeDiff).toBe(1000);
    });

    it('handles empty paths', () => {
      const cmp = viz.comparePaths([], []);
      expect(cmp.distanceDiff).toBe(0);
      expect(cmp.pathSimilarity).toBe(1);
    });
  });

  describe('setStyle / setOptions', () => {
    it('setStyle changes the visualization style', () => {
      viz.setStyle('heatmap');
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 50, mouseY: 50 }, relativeTimeMs: 0 }),
      ];
      const result = viz.visualize(actions);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('setOptions merges new options', () => {
      viz.setOptions({ pathColor: '#00FF00', style: 'dots' });
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 50, mouseY: 50 }, relativeTimeMs: 0 }),
      ];
      const result = viz.visualize(actions);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('createPathOverlay', () => {
    it('delegates to visualize', () => {
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 10, mouseY: 10 }, relativeTimeMs: 0 }),
      ];
      const result = viz.createPathOverlay(actions);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('saveToFile', () => {
    it('writes output to a file', async () => {
      const actions = [
        makeActionFrame({ visualContext: { mouseX: 10, mouseY: 10 }, relativeTimeMs: 0 }),
      ];
      const resultPath = await viz.saveToFile(actions, undefined, '/tmp/test-overlay.png');
      expect(resultPath).toBe('/tmp/test-overlay.png');
    });
  });
});
