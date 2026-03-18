/**
 * @file overlay/index.ts
 * @description Overlay entrypoint — bootstraps all overlay modules in sequence.
 *
 * This file is the single entrypoint compiled by `OverlayInjector` and injected
 * into every page via `page.addInitScript()`. It wires together the bridge,
 * context menu, inspector, and annotation modal.
 *
 * Injection order:
 * 1. `initBridge()` — expose `window.__talox__` metadata
 * 2. `installContextMenu()` — right-click interception
 * 3. `installGlobalUndoListener()` — Ctrl/Cmd+Z undo outside modal
 *
 * The inspector and modal are activated on-demand from the context menu.
 */

import { initBridge, type TaloxBridgeMeta } from './bridge.js';
import { installContextMenu }               from './contextMenu.js';
import { activateInspector }                from './elementInspector.js';
import { showAnnotationModal,
         installGlobalUndoListener }        from './annotationModal.js';
import { taloxEmit }                        from './bridge.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Bootstrap the full Talox observe overlay.
 * Called once per page by `OverlayInjector` with the session metadata.
 *
 * @param meta - Session metadata injected from the Node.js process.
 */
export function bootstrapOverlay(meta: TaloxBridgeMeta): void {
  // 1. Expose metadata
  initBridge(meta);

  // 2. Install context menu
  let interactionCounter = 0;

  installContextMenu(() => {
    // "Comment Mode" selected → activate inspector
    activateInspector((capturedElement) => {
      // Element picked → show annotation modal
      showAnnotationModal(capturedElement, interactionCounter);
    });
  });

  // 3. Global Ctrl/Cmd+Z undo
  installGlobalUndoListener();

  // 4. Track clicks for interaction counter
  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as Element;
    // Skip Talox overlay elements
    if (target.closest('#talox-annotation-modal') || target.closest('#talox-context-menu')) return;
    interactionCounter++;

    taloxEmit('interaction:click', {
      index:     interactionCounter,
      timestamp: new Date().toISOString(),
      url:       window.location.href,
      element: {
        tag:  (target.tagName ?? 'unknown').toLowerCase(),
        role: target.getAttribute('role') ?? undefined,
        text: target.textContent?.trim().slice(0, 120) ?? undefined,
      },
    });
  }, true);

  console.info(`[Talox] Observe overlay active · session ${meta.sessionId}`);
}
