/**
 * @file AnnotationBuffer.ts
 * @description In-memory annotation buffer with full undo support.
 *
 * Annotations submitted during an observe session are stored here until
 * the session ends. The buffer supports Ctrl/Cmd+Z undo — the last
 * submitted annotation can be popped at any time before session close.
 *
 * Nothing is written to disk until `ObserveSession.finalize()` flushes
 * the buffer into the `TaloxSessionReport`.
 */

import type { AnnotationEntry } from '../../types/annotation.js';

// ─── AnnotationBuffer ────────────────────────────────────────────────────────

/**
 * Append-only in-memory buffer with pop-based undo.
 *
 * @example
 * ```ts
 * const buffer = new AnnotationBuffer();
 *
 * buffer.push(entry);       // add
 * buffer.undo();            // removes and returns last entry
 * buffer.getAll();          // read-only snapshot
 * buffer.size;              // current count
 * ```
 */
export class AnnotationBuffer {
  private readonly stack: AnnotationEntry[] = [];

  // ─── Write ──────────────────────────────────────────────────────────────────

  /**
   * Append an annotation to the buffer.
   */
  push(entry: AnnotationEntry): void {
    this.stack.push(entry);
  }

  /**
   * Remove and return the most recently added annotation (Ctrl/Cmd+Z undo).
   * Returns `undefined` if the buffer is empty.
   */
  undo(): AnnotationEntry | undefined {
    return this.stack.pop();
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  /**
   * Returns a frozen snapshot of all current annotations.
   * The returned array is a copy — mutations have no effect on internal state.
   */
  getAll(): ReadonlyArray<AnnotationEntry> {
    return Object.freeze([...this.stack]);
  }

  /**
   * Returns the annotation at the given zero-based index, or `undefined`.
   */
  get(index: number): AnnotationEntry | undefined {
    return this.stack[index];
  }

  /**
   * Returns the most recently added annotation without removing it.
   */
  peek(): AnnotationEntry | undefined {
    return this.stack[this.stack.length - 1];
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  /**
   * Current number of annotations in the buffer.
   */
  get size(): number {
    return this.stack.length;
  }

  /**
   * `true` if the buffer contains no annotations.
   */
  get isEmpty(): boolean {
    return this.stack.length === 0;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Remove all annotations from the buffer.
   * Called internally after the report has been written.
   */
  clear(): void {
    this.stack.length = 0;
  }
}
