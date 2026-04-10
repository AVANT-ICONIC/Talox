/**
 * Unit tests for HumanMouse — human-like mouse movement simulation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HumanMouse } from '../../src/core/HumanMouse.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a mock Playwright page object. */
function mockPage() {
  return {
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    $: vi.fn().mockResolvedValue(null),
  };
}

/** Euclidean distance between two points. */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HumanMouse', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  // ── generatePath ──────────────────────────────────────────────────────────

  describe('generatePath', () => {
    it('returns an array of points', () => {
      const path = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 500, y: 500 });
      expect(Array.isArray(path)).toBe(true);
      expect(path.length).toBeGreaterThan(10);
    });

    it('each point has x, y, and t properties', () => {
      const path = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 100, y: 100 });
      for (const pt of path) {
        expect(pt).toHaveProperty('x');
        expect(pt).toHaveProperty('y');
        expect(pt).toHaveProperty('t');
        expect(typeof pt.x).toBe('number');
        expect(typeof pt.y).toBe('number');
        expect(typeof pt.t).toBe('number');
      }
    });

    it('starts near the start point', () => {
      const start = { x: 100, y: 200 };
      const path = HumanMouse.generatePath(start, { x: 600, y: 700 });
      const first = path[0]!;
      // Due to rounding/jitter, allow ~5px tolerance
      expect(Math.abs(first.x - start.x)).toBeLessThan(5);
      expect(Math.abs(first.y - start.y)).toBeLessThan(5);
    });

    it('ends near the end point', () => {
      const end = { x: 800, y: 600 };
      const path = HumanMouse.generatePath({ x: 100, y: 100 }, end);
      const last = path[path.length - 1]!;
      expect(Math.abs(last.x - end.x)).toBeLessThan(5);
      expect(Math.abs(last.y - end.y)).toBeLessThan(5);
    });

    it('timestamps are monotonically increasing', () => {
      const path = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 300, y: 300 });
      for (let i = 1; i < path.length; i++) {
        expect(path[i]!.t!).toBeGreaterThanOrEqual(path[i - 1]!.t!);
      }
    });

    it('produces more steps for longer distances', () => {
      const short = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 10, y: 10 });
      const long = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 2000, y: 2000 });
      expect(long.length).toBeGreaterThan(short.length);
    });

    it('produces fewer steps with higher speedMultiplier', () => {
      const normal = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 800, y: 800 }, 100, 1.0);
      const fast = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 800, y: 800 }, 100, 3.0);
      expect(fast.length).toBeLessThanOrEqual(normal.length);
    });

    it('uses default targetWidth of 100 when not specified', () => {
      const path1 = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 500, y: 500 });
      expect(path1.length).toBeGreaterThan(10);
      expect(path1.length).toBeLessThanOrEqual(200);
    });

    it('respects a small target width (more steps)', () => {
      const bigTarget = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 500, y: 500 }, 500);
      const smallTarget = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 500, y: 500 }, 10);
      expect(smallTarget.length).toBeGreaterThanOrEqual(bigTarget.length);
    });

    it('step count is capped at 200', () => {
      // Very small target + long distance + slow speed
      const path = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 5000, y: 5000 }, 1, 0.1);
      expect(path.length).toBeLessThanOrEqual(201); // steps + 1 for the 0..=steps loop
    });

    it('step count has a minimum of 10', () => {
      const path = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 1, y: 1 }, 5000, 5.0);
      expect(path.length).toBeGreaterThanOrEqual(11); // min steps + 1
    });

    it('path is reasonably smooth (consecutive points are close)', () => {
      const path = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 500, y: 500 });
      const totalDist = dist({ x: 0, y: 0 }, { x: 500, y: 500 });
      // Allow generous margin for Bezier arc + jitter at peak speed
      const maxStep = totalDist / (path.length - 1) * 8;
      for (let i = 1; i < path.length; i++) {
        const stepDist = dist(path[i - 1]!, path[i]!);
        expect(stepDist).toBeLessThan(maxStep);
      }
    });

    it('paths have some randomness (two calls differ)', () => {
      const p1 = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 400, y: 400 });
      const p2 = HumanMouse.generatePath({ x: 0, y: 0 }, { x: 400, y: 400 });
      // At least one intermediate point should differ
      let differ = false;
      for (let i = 0; i < Math.min(p1.length, p2.length); i++) {
        if (p1[i]!.x !== p2[i]!.x || p1[i]!.y !== p2[i]!.y) {
          differ = true;
          break;
        }
      }
      expect(differ).toBe(true);
    });
  });

  // ── move (headless mode) ─────────────────────────────────────────────────

  describe('move', () => {
    it('calls page.mouse.move for every step in headless mode', async () => {
      const page = mockPage();
      const movePromise = HumanMouse.move(page, 200, 200, 100, true, { x: 0, y: 0 }, 5.0);
      await vi.advanceTimersByTimeAsync(5000);
      await movePromise;
      expect(page.mouse.move).toHaveBeenCalled();
      expect(page.mouse.move.mock.calls.length).toBeGreaterThan(5);
    });

    it('uses default start position (400,300) when currentPos is not provided', async () => {
      const page = mockPage();
      const movePromise = HumanMouse.move(page, 500, 400, 100, true, undefined, 5.0);
      await vi.advanceTimersByTimeAsync(5000);
      await movePromise;
      expect(page.mouse.move).toHaveBeenCalled();
    });

    it('uses onStep callback when provided (headed mode)', async () => {
      const page = mockPage();
      const onStep = vi.fn().mockResolvedValue(undefined);
      const movePromise = HumanMouse.move(page, 100, 100, 100, true, { x: 0, y: 0 }, 5.0, onStep);
      await vi.advanceTimersByTimeAsync(5000);
      await movePromise;
      // onStep should be called for every intermediate step
      expect(onStep.mock.calls.length).toBeGreaterThan(5);
      // page.mouse.move should only be called once (final position)
      expect(page.mouse.move).toHaveBeenCalledTimes(1);
    });

    it('final page.mouse.move target is near the destination', async () => {
      const page = mockPage();
      const targetX = 250;
      const targetY = 350;
      const movePromise = HumanMouse.move(page, targetX, targetY, 100, true, { x: 0, y: 0 }, 5.0);
      await vi.advanceTimersByTimeAsync(5000);
      await movePromise;
      const lastCall = page.mouse.move.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      expect(Math.abs(lastCall![0] - targetX)).toBeLessThan(10);
      expect(Math.abs(lastCall![1] - targetY)).toBeLessThan(10);
    });
  });

  // ── click ──────────────────────────────────────────────────────────────────

  describe('click', () => {
    it('returns default position when element not found', async () => {
      const page = mockPage();
      page.$ = vi.fn().mockResolvedValue(null);
      const result = await HumanMouse.click(page, '#nonexistent', false, { x: 50, y: 50 }, 5.0);
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('returns {0,0} when element not found and no currentPos', async () => {
      const page = mockPage();
      page.$ = vi.fn().mockResolvedValue(null);
      const result = await HumanMouse.click(page, '#missing');
      expect(result).toEqual({ x: 0, y: 0 });
    });

    it('returns default position when boundingBox is null', async () => {
      const page = mockPage();
      const el = { boundingBox: vi.fn().mockResolvedValue(null) };
      page.$ = vi.fn().mockResolvedValue(el);
      const result = await HumanMouse.click(page, '#invisible', false, { x: 10, y: 20 }, 5.0);
      expect(result).toEqual({ x: 10, y: 20 });
    });

    it('performs mouse down and up when element is found', async () => {
      const page = mockPage();
      const el = {
        boundingBox: vi.fn().mockResolvedValue({ x: 100, y: 100, width: 200, height: 50 }),
      };
      page.$ = vi.fn().mockResolvedValue(el);
      const clickPromise = HumanMouse.click(page, '#btn', true, { x: 0, y: 0 }, 5.0);
      await vi.advanceTimersByTimeAsync(5000);
      await clickPromise;
      expect(page.mouse.down).toHaveBeenCalled();
      expect(page.mouse.up).toHaveBeenCalled();
    });

    it('click result coordinates are near the element', async () => {
      const page = mockPage();
      const box = { x: 100, y: 200, width: 300, height: 100 };
      const el = { boundingBox: vi.fn().mockResolvedValue(box) };
      page.$ = vi.fn().mockResolvedValue(el);
      const clickPromise = HumanMouse.click(page, '#btn', true, { x: 0, y: 0 }, 5.0);
      await vi.advanceTimersByTimeAsync(5000);
      const result = await clickPromise;
      // Click should land within the bounding box (with some margin for jitter)
      expect(result.x).toBeGreaterThanOrEqual(box.x - 5);
      expect(result.x).toBeLessThanOrEqual(box.x + box.width + 5);
      expect(result.y).toBeGreaterThanOrEqual(box.y - 5);
      expect(result.y).toBeLessThanOrEqual(box.y + box.height + 5);
    });
  });

  // ── fidget ─────────────────────────────────────────────────────────────────

  describe('fidget', () => {
    it('calls page.mouse.move in headless mode', async () => {
      const page = mockPage();
      const fidgetPromise = HumanMouse.fidget(page, 400, 300, 100);
      await vi.advanceTimersByTimeAsync(2000);
      await fidgetPromise;
      expect(page.mouse.move).toHaveBeenCalled();
    });

    it('uses onStep callback when provided', async () => {
      const page = mockPage();
      const onStep = vi.fn().mockResolvedValue(undefined);
      const fidgetPromise = HumanMouse.fidget(page, 400, 300, 100, onStep);
      await vi.advanceTimersByTimeAsync(2000);
      await fidgetPromise;
      expect(onStep).toHaveBeenCalled();
      // In headed mode, page.mouse.move should not be called
      expect(page.mouse.move).not.toHaveBeenCalled();
    });
  });
});
