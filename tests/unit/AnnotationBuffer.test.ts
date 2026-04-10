/**
 * Tests for AnnotationBuffer — in-memory annotation queue with undo support.
 */
import { describe, it, expect } from 'vitest';
import { AnnotationBuffer } from '../../src/core/observe/AnnotationBuffer.js';
import type { AnnotationEntry } from '../../src/types/annotation.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AnnotationEntry> = {}): AnnotationEntry {
  return {
    id: crypto.randomUUID(),
    interactionIndex: 0,
    timestamp: new Date().toISOString(),
    labels: ['bug'],
    comment: 'Test annotation',
    element: {
      tag: 'button',
      role: 'button',
      text: 'Click me',
      selector: 'button.click',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AnnotationBuffer', () => {
  it('starts empty', () => {
    const buf = new AnnotationBuffer();
    expect(buf.size).toBe(0);
    expect(buf.isEmpty).toBe(true);
  });

  it('push adds an entry and increases size', () => {
    const buf = new AnnotationBuffer();
    const entry = makeEntry();
    buf.push(entry);
    expect(buf.size).toBe(1);
    expect(buf.isEmpty).toBe(false);
  });

  it('getAll returns a frozen copy of all entries', () => {
    const buf = new AnnotationBuffer();
    const e1 = makeEntry({ comment: 'first' });
    const e2 = makeEntry({ comment: 'second' });
    buf.push(e1);
    buf.push(e2);

    const all = buf.getAll();
    expect(all).toHaveLength(2);
    expect(all[0]).toBe(e1);
    expect(all[1]).toBe(e2);

    // Returned array is frozen (immutable snapshot)
    expect(Object.isFrozen(all)).toBe(true);
  });

  it('getAll returns a copy — mutating it does not affect internal state', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry());
    const snapshot = buf.getAll();

    // Attempt mutation (cast to any since it's frozen)
    expect(() => { (snapshot as AnnotationEntry[]).push(makeEntry()); }).toThrow();
    expect(buf.size).toBe(1);
  });

  it('get returns the entry at a given index', () => {
    const buf = new AnnotationBuffer();
    const e1 = makeEntry({ comment: 'first' });
    const e2 = makeEntry({ comment: 'second' });
    buf.push(e1);
    buf.push(e2);

    expect(buf.get(0)).toBe(e1);
    expect(buf.get(1)).toBe(e2);
  });

  it('get returns undefined for out-of-bounds indices', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry());
    expect(buf.get(-1)).toBeUndefined();
    expect(buf.get(99)).toBeUndefined();
    expect(buf.get(1)).toBeUndefined();
  });

  it('peek returns the most recent entry without removing it', () => {
    const buf = new AnnotationBuffer();
    const e1 = makeEntry({ comment: 'first' });
    const e2 = makeEntry({ comment: 'second' });
    buf.push(e1);
    buf.push(e2);

    expect(buf.peek()).toBe(e2);
    expect(buf.size).toBe(2); // not removed
  });

  it('peek returns undefined when buffer is empty', () => {
    const buf = new AnnotationBuffer();
    expect(buf.peek()).toBeUndefined();
  });

  it('undo removes and returns the last entry', () => {
    const buf = new AnnotationBuffer();
    const e1 = makeEntry({ comment: 'first' });
    const e2 = makeEntry({ comment: 'second' });
    buf.push(e1);
    buf.push(e2);

    const removed = buf.undo();
    expect(removed).toBe(e2);
    expect(buf.size).toBe(1);
    expect(buf.peek()).toBe(e1);
  });

  it('undo returns undefined when buffer is empty', () => {
    const buf = new AnnotationBuffer();
    expect(buf.undo()).toBeUndefined();
    expect(buf.size).toBe(0);
  });

  it('clear removes all entries', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry());
    buf.push(makeEntry());
    buf.push(makeEntry());
    expect(buf.size).toBe(3);

    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.isEmpty).toBe(true);
    expect(buf.peek()).toBeUndefined();
  });

  it('push after clear works correctly', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry({ comment: 'before clear' }));
    buf.clear();
    const entry = makeEntry({ comment: 'after clear' });
    buf.push(entry);

    expect(buf.size).toBe(1);
    expect(buf.peek()?.comment).toBe('after clear');
  });

  it('multiple undos in sequence drain the buffer correctly', () => {
    const buf = new AnnotationBuffer();
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    for (const e of entries) buf.push(e);

    expect(buf.undo()).toBe(entries[2]);
    expect(buf.undo()).toBe(entries[1]);
    expect(buf.undo()).toBe(entries[0]);
    expect(buf.undo()).toBeUndefined();
    expect(buf.isEmpty).toBe(true);
  });

  it('maintains insertion order through push/undo cycles', () => {
    const buf = new AnnotationBuffer();
    const e1 = makeEntry({ comment: 'A' });
    const e2 = makeEntry({ comment: 'B' });
    const e3 = makeEntry({ comment: 'C' });

    buf.push(e1);
    buf.push(e2);
    buf.undo(); // remove B
    buf.push(e3);

    expect(buf.getAll()).toHaveLength(2);
    expect(buf.get(0)).toBe(e1);
    expect(buf.get(1)).toBe(e3);
  });
});
