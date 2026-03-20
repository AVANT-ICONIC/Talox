/**
 * @file annotationModal.ts
 * @description Talox overlay annotation modal.
 *
 * Shown after the human selects an element in Comment Mode. The modal provides:
 *
 * - **Header**   — Read-only element identifier (📍 `<button> "Submit Order"`)
 * - **Tags**     — Multiselect chips (Bug, Note, Question, Improvement) + custom tag input
 * - **Textarea** — Free-text comment field, vertically resizable with custom ↘ handle
 * - **Footer**   — Cancel (ghost) + 💾 Save (primary) button row
 *
 * Ctrl/Cmd+Z after saving emits `'annotation:undo'` to remove the last annotation.
 *
 * This file runs inside the browser page context (injected via addInitScript).
 */

import { taloxEmit }            from './bridge.js';
import type { CapturedElement } from './elementInspector.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnnotationSubmission {
  labels:      string[];
  comment:     string;
  element:     CapturedElement;
  timestamp:   string;
}

// ─── Preset Tags ─────────────────────────────────────────────────────────────

const PRESET_TAGS = [
  { label: 'bug',         emoji: '🐛' },
  { label: 'note',        emoji: '📝' },
  { label: 'question',    emoji: '❓' },
  { label: 'improvement', emoji: '✨' },
] as const;

// ─── Styles ───────────────────────────────────────────────────────────────────

const MODAL_STYLES = `
  /* ── Backdrop ─────────────────────────────────────────────────────────── */
  #talox-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483640;
    background: rgba(0, 0, 0, 0.25);
    animation: talox-fade-in 150ms ease;
    pointer-events: auto;
  }

  /* ── Modal ────────────────────────────────────────────────────────────── */
  #talox-annotation-modal {
    position: fixed;
    z-index: 2147483641;
    width: min(720px, calc(100vw - 32px));
    max-height: min(86vh, 760px);
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 16px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.72);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 14px;
    color: #fafafa;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: talox-modal-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes talox-modal-in {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }

  /* ── Header ───────────────────────────────────────────────────────────── */
  .talox-modal-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 18px 14px;
    background: #09090b;
    border-bottom: 1px solid #27272a;
  }

  .talox-modal-header-pin {
    font-size: 16px;
    flex-shrink: 0;
  }

  .talox-modal-header-label {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    color: #a1a1aa;
    white-space: normal;
    word-break: break-word;
    line-height: 1.5;
  }

  /* ── Body ─────────────────────────────────────────────────────────────── */
  .talox-modal-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow-y: auto;
  }

  .talox-modal-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ── Section labels ───────────────────────────────────────────────────── */
  .talox-section-label {
    font-size: 11px;
    font-weight: 600;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: block;
  }

  /* ── Tags ─────────────────────────────────────────────────────────────── */
  .talox-tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }

  .talox-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 34px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid #3f3f46;
    background: transparent;
    color: #a1a1aa;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    transition: all 80ms ease;
    white-space: nowrap;
  }

  .talox-tag-chip:hover {
    border-color: #71717a;
    color: #fafafa;
  }

  .talox-tag-chip--active {
    border-color: #3B82F6;
    background: rgba(59, 130, 246, 0.12);
    color: #93C5FD;
  }

  .talox-tag-chip--active:hover {
    background: rgba(59, 130, 246, 0.2);
  }

  .talox-tag-chip-remove {
    font-size: 10px;
    color: #71717a;
    cursor: pointer;
    padding: 0 0 0 2px;
  }

  .talox-custom-tag-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    border: 1px solid #3f3f46;
    background: #09090b;
    border-radius: 12px;
    padding: 12px;
  }

  .talox-custom-tag-prefix {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #71717a;
  }

  .talox-custom-tag-input {
    width: 100%;
    border: 1px solid #27272a;
    background: #111114;
    color: #fafafa;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    padding: 12px 14px;
    border-radius: 10px;
    box-sizing: border-box;
  }

  .talox-custom-tag-input::placeholder {
    color: #52525b;
  }

  /* ── Textarea ─────────────────────────────────────────────────────────── */
  .talox-comment-wrapper {
    position: relative;
  }

  .talox-comment-input {
    width: 100%;
    min-height: 180px;
    max-height: 42vh;
    resize: vertical;
    background: #09090b;
    border: 1px solid #3f3f46;
    border-radius: 10px;
    color: #fafafa;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    padding: 12px 14px;
    box-sizing: border-box;
    outline: none;
    transition: border-color 80ms ease;
  }

  .talox-comment-input:focus {
    border-color: #3B82F6;
  }

  .talox-comment-input::placeholder {
    color: #52525b;
  }

  /* ── Divider ──────────────────────────────────────────────────────────── */
  .talox-modal-divider {
    height: 1px;
    background: #27272a;
  }

  /* ── Footer ───────────────────────────────────────────────────────────── */
  .talox-modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px 18px;
    background: linear-gradient(180deg, rgba(24,24,27,0.94), rgba(9,9,11,0.98));
  }

  .talox-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 132px;
    min-height: 44px;
    padding: 10px 14px;
    border-radius: 10px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 80ms ease;
    border: none;
  }

  .talox-btn--ghost {
    background: transparent;
    color: #71717a;
    border: 1px solid #3f3f46;
  }

  .talox-btn--ghost:hover {
    background: #27272a;
    color: #a1a1aa;
  }

  .talox-btn--primary {
    background: #3B82F6;
    color: #fff;
  }

  .talox-btn--primary:hover {
    background: #2563EB;
  }

  .talox-btn--primary:active {
    background: #1D4ED8;
  }

  @media (max-width: 640px) {
    #talox-annotation-modal {
      width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
    }

    .talox-modal-header {
      padding: 14px 14px 12px;
    }

    .talox-modal-body {
      padding: 14px;
    }

    .talox-modal-footer {
      padding: 12px 14px 14px;
      flex-direction: column-reverse;
      align-items: stretch;
    }

    .talox-btn {
      width: 100%;
    }
  }

  /* ── Undo toast ───────────────────────────────────────────────────────── */
  #talox-undo-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #27272a;
    color: #fafafa;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    padding: 9px 16px;
    border-radius: 8px;
    border: 1px solid #3f3f46;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    pointer-events: none;
    animation: talox-fade-in 150ms ease;
  }
`;

// ─── AnnotationModal ─────────────────────────────────────────────────────────

/**
 * Show the annotation modal anchored near the given element.
 *
 * @param element           - The element captured by the inspector.
 * @param interactionIndex  - Current interaction counter (links annotation to timeline).
 */
export function showAnnotationModal(
  element:          CapturedElement,
  interactionIndex: number,
): void {
  injectStyles();
  cleanup();

  const activeTags = new Set<string>();

  // ── Build DOM ────────────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.id = 'talox-modal-backdrop';

  const modal = document.createElement('div');
  modal.id = 'talox-annotation-modal';

  const elementLabel = element.text
    ? `<${element.tag}> "${element.text.slice(0, 50)}"`
    : `<${element.tag}> [${element.role ?? element.tag}]`;

  modal.innerHTML = `
    <div class="talox-modal-header">
      <span class="talox-modal-header-pin">📍</span>
      <code class="talox-modal-header-label" title="${elementLabel}">${elementLabel}</code>
    </div>

    <div class="talox-modal-body">
      <div class="talox-modal-section">
        <span class="talox-section-label">Tags</span>
        <div class="talox-tags-container" id="talox-tags-container">
          ${PRESET_TAGS.map(t => `
            <button
              class="talox-tag-chip"
              data-label="${t.label}"
              type="button"
            >${t.emoji} ${t.label.charAt(0).toUpperCase() + t.label.slice(1)}</button>
          `).join('')}
        </div>
        <div class="talox-custom-tag-row">
          <span class="talox-custom-tag-prefix">+ custom tag</span>
          <input
            class="talox-custom-tag-input"
            id="talox-custom-tag-input"
            placeholder="type and press Enter"
            type="text"
            autocomplete="off"
          />
        </div>
      </div>

      <div class="talox-modal-section">
        <span class="talox-section-label">Comment</span>
        <div class="talox-comment-wrapper">
        <textarea
          class="talox-comment-input"
          id="talox-comment-input"
          placeholder="What is wrong here, what feels off, or what should change?"
          rows="6"
        ></textarea>
        </div>
      </div>
    </div>

    <div class="talox-modal-divider"></div>

    <div class="talox-modal-footer">
      <button class="talox-btn talox-btn--ghost" id="talox-modal-cancel" type="button">
        Cancel
      </button>
      <button class="talox-btn talox-btn--primary" id="talox-modal-save" type="button">
        💾 Save
      </button>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);

  // Position modal near element, clamped to viewport
  positionModal(modal, element.boundingBox);

  // ── Preset tag chips ────────────────────────────────────────────────────
  const tagsContainer = document.getElementById('talox-tags-container')!;
  tagsContainer.querySelectorAll<HTMLButtonElement>('.talox-tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const label = chip.dataset['label']!;
      if (activeTags.has(label)) {
        activeTags.delete(label);
        chip.classList.remove('talox-tag-chip--active');
      } else {
        activeTags.add(label);
        chip.classList.add('talox-tag-chip--active');
      }
    });
  });

  // ── Custom tag input ────────────────────────────────────────────────────
  const customInput = document.getElementById('talox-custom-tag-input') as HTMLInputElement;
  customInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = customInput.value.trim();
      if (value && !activeTags.has(value)) {
        activeTags.add(value);
        addCustomChip(tagsContainer, value, activeTags);
        customInput.value = '';
      }
    }
  });

  // ── Buttons ────────────────────────────────────────────────────────────
  document.getElementById('talox-modal-cancel')?.addEventListener('click', cleanup);

  document.getElementById('talox-modal-save')?.addEventListener('click', () => {
    const comment = (document.getElementById('talox-comment-input') as HTMLTextAreaElement).value.trim();
    const labels  = Array.from(activeTags);

    const submission: AnnotationSubmission = {
      labels,
      comment,
      element,
      timestamp: new Date().toISOString(),
    };

    taloxEmit('annotation:add', {
      ...submission,
      interactionIndex,
    });

    cleanup();
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  const keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', keyHandler, true);
    }

    // Ctrl/Cmd+Z — undo last submitted annotation
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      taloxEmit('annotation:undo', {});
      showUndoToast();
    }
  };
  document.addEventListener('keydown', keyHandler, true);

  // ── Outside-click dismiss (backdrop has pointer-events:none so we use document) ──
  const outsideClickHandler = (e: MouseEvent): void => {
    if (!(e.target as Element).closest?.('#talox-annotation-modal')) {
      cleanup();
      document.removeEventListener('mousedown', outsideClickHandler, true);
    }
  };
  document.addEventListener('mousedown', outsideClickHandler, true);

  // Focus comment textarea
  setTimeout(() => {
    (document.getElementById('talox-comment-input') as HTMLTextAreaElement)?.focus();
  }, 50);
}

// ─── Global Undo Listener ────────────────────────────────────────────────────

/**
 * Install a global Ctrl/Cmd+Z undo listener that works even when the modal
 * is closed. This lets the human undo annotations at any point during the session.
 */
export function installGlobalUndoListener(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // Only intercept when modal is NOT open (modal has its own handler)
    if (document.getElementById('talox-annotation-modal')) return;

    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      taloxEmit('annotation:undo', {});
      showUndoToast();
    }
  }, true);
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

function addCustomChip(
  container:   HTMLElement,
  label:       string,
  activeTags:  Set<string>,
): void {
  const chip = document.createElement('button');
  chip.className = 'talox-tag-chip talox-tag-chip--active';
  chip.dataset['label']  = label;
  chip.dataset['custom'] = 'true';
  chip.type = 'button';

  const labelSpan = document.createElement('span');
  labelSpan.textContent = `🏷️ ${label}`;

  const removeSpan = document.createElement('span');
  removeSpan.className = 'talox-tag-chip-remove';
  removeSpan.textContent = '×';
  removeSpan.addEventListener('click', (e) => {
    e.stopPropagation();
    activeTags.delete(label);
    chip.remove();
  });

  chip.appendChild(labelSpan);
  chip.appendChild(removeSpan);

  container.appendChild(chip);
}

function positionModal(
  modal:       HTMLElement,
  _elementBox: { x: number; y: number; width: number; height: number },
): void {
  const modalRect   = modal.getBoundingClientRect();
  const modalWidth  = modalRect.width;
  const modalHeight = modalRect.height;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const top = Math.max(16, Math.round((vh - modalHeight) / 2));
  const left = Math.max(16, Math.round((vw - modalWidth) / 2));

  modal.style.top  = `${top}px`;
  modal.style.left = `${left}px`;
}

function cleanup(): void {
  document.getElementById('talox-modal-backdrop')?.remove();
  document.getElementById('talox-annotation-modal')?.remove();
}

function showUndoToast(): void {
  const existing = document.getElementById('talox-undo-toast');
  existing?.remove();

  const toast = document.createElement('div');
  toast.id = 'talox-undo-toast';
  toast.textContent = '↩ Annotation removed';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function injectStyles(): void {
  if (document.getElementById('talox-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'talox-modal-styles';
  style.textContent = MODAL_STYLES;
  document.head.appendChild(style);
}
