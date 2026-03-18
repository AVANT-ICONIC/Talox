/**
 * @file OverlayInjector.ts
 * @description Injects the Talox observe overlay into every page navigation.
 *
 * Uses `page.addInitScript()` so the overlay is present from the very first
 * frame — including SPAs where subsequent route changes don't fire full page
 * loads. Uses `page.exposeFunction('__taloxEmit__', handler)` as the CDP
 * bridge for browser → Node.js communication.
 *
 * The overlay bundle is compiled inline from the TypeScript source files using
 * `esbuild` at runtime the first time it is needed, then cached in memory.
 */

import path    from 'path';
import { fileURLToPath } from 'url';
import type { TaloxEventMap }       from '../../types/events.js';
import type { TaloxInteraction }    from '../../types/session.js';
import type { AnnotationEntry }     from '../../types/annotation.js';
import type { EventBus }            from '../controller/EventBus.js';
import type { AnnotationBuffer }    from './AnnotationBuffer.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Raw overlay event received from the browser via __taloxEmit__. */
interface OverlayEvent {
  type:    string;
  payload: unknown;
}

// ─── OverlayInjector ─────────────────────────────────────────────────────────

/**
 * Manages overlay injection and bridge event routing for an observe session.
 */
export class OverlayInjector {
  private bundleCache:      string | null = null;
  private readonly sessionId:    string;
  private readonly startedAt:    string;
  private readonly annotBuffer:  AnnotationBuffer;
  private readonly eventBus:     EventBus<TaloxEventMap>;
  private readonly interactions: TaloxInteraction[];
  private          bridgeInstalled: boolean = false;

  constructor(
    sessionId:    string,
    startedAt:    string,
    annotBuffer:  AnnotationBuffer,
    eventBus:     EventBus<TaloxEventMap>,
    interactions: TaloxInteraction[],
  ) {
    this.sessionId    = sessionId;
    this.startedAt    = startedAt;
    this.annotBuffer  = annotBuffer;
    this.eventBus     = eventBus;
    this.interactions = interactions;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Inject the overlay into the given page.
   * Safe to call multiple times — injection is idempotent.
   *
   * @param page - The Playwright `Page` instance.
   */
  async inject(page: any): Promise<void> {
    // Install the CDP bridge function (exposeFunction is idempotent)
    if (!this.bridgeInstalled) {
      await page.exposeFunction('__taloxEmit__', this.handleBridgeEvent.bind(this));
      this.bridgeInstalled = true;
    }

    // Build and inject the overlay bootstrap script
    const bundle = await this.getBundle();
    const meta   = JSON.stringify({
      version:   '1.2.0',
      sessionId: this.sessionId,
      startedAt: this.startedAt,
    });

    await page.addInitScript(`
      (function() {
        try {
          ${bundle}
          if (typeof bootstrapOverlay === 'function') {
            bootstrapOverlay(${meta});
          }
        } catch (err) {
          console.warn('[Talox] Overlay bootstrap error:', err);
        }
      })();
    `);

    // Also inject on every subsequent load event (handles SPAs and hard navigations)
    page.on('load', async () => {
      try {
        await page.evaluate(`
          (function() {
            if (window.__talox__) return; // already injected
            ${bundle}
            if (typeof bootstrapOverlay === 'function') {
              bootstrapOverlay(${meta});
            }
          })();
        `);
      } catch {
        // Page may have navigated away — ignore
      }
    });
  }

  // ─── Bridge Event Handler ────────────────────────────────────────────────────

  /**
   * Routes events received from the browser overlay to the appropriate
   * session handlers and emits typed events on the shared EventBus.
   */
  private handleBridgeEvent(type: string, payload: unknown): void {
    switch (type) {

      case 'annotation:add': {
        const entry = payload as AnnotationEntry;
        this.annotBuffer.push(entry);
        this.eventBus.emit('annotationAdded', {
          entry,
          bufferSize: this.annotBuffer.size,
        });
        break;
      }

      case 'annotation:undo': {
        const removed = this.annotBuffer.undo();
        if (removed) {
          this.eventBus.emit('annotationUndone', {
            removed,
            bufferSize: this.annotBuffer.size,
          });
        }
        break;
      }

      case 'interaction:click': {
        const interaction = payload as TaloxInteraction;
        this.interactions.push({
          ...interaction,
          consoleErrors:   [],
          networkFailures: [],
        });
        break;
      }

      case 'snapshot:request': {
        // ObserveSession handles this via its page reference
        this.eventBus.emit('stateChanged', payload as any);
        break;
      }

      case 'session:end': {
        // Handled by ObserveSession — this is a no-op here
        break;
      }

      default: {
        console.warn(`[Talox] Unknown overlay event type: ${type}`);
      }
    }
  }

  // ─── Bundle Build ────────────────────────────────────────────────────────────

  /**
   * Build (or return cached) the overlay bundle.
   * Uses esbuild to compile the TypeScript overlay source into a self-contained
   * IIFE string that can be injected via `addInitScript`.
   */
  private async getBundle(): Promise<string> {
    if (this.bundleCache) return this.bundleCache;

    // import.meta.url resolves to dist/core/observe/OverlayInjector.js at runtime.
    // Navigate back to the project root (../../../) then into src/ where the
    // TypeScript overlay source lives for esbuild to compile.
    const overlayEntryPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..',
      'src', 'core', 'observe', 'overlay', 'index.ts',
    );

    try {
      // Dynamic import so esbuild is only required when observe mode is used
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — esbuild is an optional peer dependency; graceful fallback below
      const esbuild = await import('esbuild') as any;
      const result  = await esbuild.build({
        entryPoints: [overlayEntryPath],
        bundle:      true,
        format:      'iife',
        globalName:  'TaloxOverlay',
        write:       false,
        platform:    'browser',
        target:      ['chrome100'],
        minify:      true,
        // Expose `bootstrapOverlay` as a global function
        footer: {
          js: 'var bootstrapOverlay = TaloxOverlay.bootstrapOverlay;',
        },
      });

      const outputFile = result.outputFiles[0];
      if (!outputFile) throw new Error('esbuild produced no output');

      this.bundleCache = outputFile.text;
      return this.bundleCache!;

    } catch (err) {
      console.warn(
        '[Talox] esbuild not available — overlay using fallback stub. ' +
        'Install esbuild to enable the full overlay UI: `npm install esbuild`',
      );

      // Graceful fallback: minimal overlay without the full UI
      this.bundleCache = this.getFallbackBundle();
      return this.bundleCache;
    }
  }

  /**
   * Returns a minimal overlay bundle for environments without esbuild.
   * Provides basic click tracking and Ctrl/Cmd+Z support without the visual UI.
   */
  private getFallbackBundle(): string {
    return `
      var bootstrapOverlay = function(meta) {
        Object.defineProperty(window, '__talox__', { value: Object.freeze(meta) });
        var counter = 0;
        document.addEventListener('click', function(e) {
          if (e.target.closest && e.target.closest('[id^="talox-"]')) return;
          counter++;
          if (typeof window.__taloxEmit__ === 'function') {
            window.__taloxEmit__('interaction:click', {
              index: counter,
              timestamp: new Date().toISOString(),
              url: window.location.href,
              element: {
                tag: (e.target.tagName || 'unknown').toLowerCase(),
                text: (e.target.textContent || '').trim().slice(0, 120)
              }
            });
          }
        }, true);
        document.addEventListener('keydown', function(e) {
          if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (typeof window.__taloxEmit__ === 'function') {
              window.__taloxEmit__('annotation:undo', {});
            }
          }
        }, true);
        console.info('[Talox] Observe overlay active (fallback mode) · session ' + meta.sessionId);
      };
    `;
  }
}
