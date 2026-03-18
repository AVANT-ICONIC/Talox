import { describe, it, expect } from 'vitest';
import { AnnotationBuffer } from '../../../src/core/observe/AnnotationBuffer';

function makeEntry(id: string, comment = 'test comment') {
  return {
    id,
    interactionIndex: 0,
    timestamp: new Date().toISOString(),
    labels: ['bug'],
    comment,
    element: {
      tag: 'button',
      role: 'button',
      selector: '#submit',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    },
  };
}

describe('AnnotationBuffer', () => {
  it('starts empty', () => {
    const buf = new AnnotationBuffer();
    expect(buf.isEmpty).toBe(true);
    expect(buf.size).toBe(0);
  });

  it('push() increments size and isEmpty becomes false', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('a1'));
    expect(buf.size).toBe(1);
    expect(buf.isEmpty).toBe(false);
  });

  it('getAll() returns a frozen snapshot of all entries', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('a1'));
    buf.push(makeEntry('a2'));

    const all = buf.getAll();
    expect(all.length).toBe(2);
    expect(all[0]!.id).toBe('a1');
    expect(all[1]!.id).toBe('a2');

    // Frozen — mutations are silently ignored or throw in strict mode
    expect(Object.isFrozen(all)).toBe(true);
  });

  it('getAll() is a copy — external mutations do not affect internal state', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('a1'));

    const snapshot = buf.getAll() as any[];
    // Attempt mutation (will throw in strict mode on frozen array, ignore otherwise)
    try { snapshot.push(makeEntry('a2')); } catch { /* expected */ }

    expect(buf.size).toBe(1);
  });

  it('peek() returns the last entry without removing it', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('a1'));
    buf.push(makeEntry('a2'));

    expect(buf.peek()?.id).toBe('a2');
    expect(buf.size).toBe(2);
  });

  it('peek() returns undefined on empty buffer', () => {
    const buf = new AnnotationBuffer();
    expect(buf.peek()).toBeUndefined();
  });

  it('get() returns the entry at a given index', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('first'));
    buf.push(makeEntry('second'));

    expect(buf.get(0)?.id).toBe('first');
    expect(buf.get(1)?.id).toBe('second');
    expect(buf.get(99)).toBeUndefined();
  });

  it('undo() removes and returns the last entry (LIFO)', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('a1'));
    buf.push(makeEntry('a2'));
    buf.push(makeEntry('a3'));

    const removed = buf.undo();
    expect(removed?.id).toBe('a3');
    expect(buf.size).toBe(2);
  });

  it('undo() returns undefined when buffer is empty', () => {
    const buf = new AnnotationBuffer();
    expect(buf.undo()).toBeUndefined();
    expect(buf.size).toBe(0);
  });

  it('sequential undo() pops in reverse insertion order', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('x1'));
    buf.push(makeEntry('x2'));
    buf.push(makeEntry('x3'));

    expect(buf.undo()?.id).toBe('x3');
    expect(buf.undo()?.id).toBe('x2');
    expect(buf.undo()?.id).toBe('x1');
    expect(buf.undo()).toBeUndefined();
  });

  it('clear() empties the buffer', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('a1'));
    buf.push(makeEntry('a2'));
    buf.clear();

    expect(buf.isEmpty).toBe(true);
    expect(buf.size).toBe(0);
    expect(buf.getAll().length).toBe(0);
  });

  it('push after undo continues correctly', () => {
    const buf = new AnnotationBuffer();
    buf.push(makeEntry('a1'));
    buf.undo();
    buf.push(makeEntry('a2'));

    expect(buf.size).toBe(1);
    expect(buf.peek()?.id).toBe('a2');
  });
});
