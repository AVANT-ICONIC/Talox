/**
 * @file ObserveSession.ts
 * @description Orchestrates the full lifecycle of an observe-mode session.
 *
 * When `TaloxController` is launched in `observe` mode, it delegates entirely
 * to `ObserveSession`. The session:
 *
 * 1. Injects the overlay into every page via `OverlayInjector`
 * 2. Passively captures all human interactions (clicks, navigations)
 * 3. Captures console errors and network failures alongside interactions
 * 4. Routes overlay events (annotation add/undo, session end) via the bridge
 * 5. Auto-finalizes when the browser is closed (hooks `browserContext.on('close')`)
 * 6. Writes the session report and fires the `sessionEnd` event
 */

import { randomUUID }               from 'crypto';
import path                         from 'path';
import type { TaloxEventMap }       from '../../types/events.js';
import type {
  TaloxSessionReport,
  TaloxInteraction,
  TaloxSessionSummary,
  ObserveSessionOptions,
}                                   from '../../types/session.js';
import type { AnnotationEntry }     from '../../types/annotation.js';
import type { EventBus }            from '../controller/EventBus.js';
import { AnnotationBuffer }         from './AnnotationBuffer.js';
import { OverlayInjector }          from './OverlayInjector.js';
import { SessionReporter }          from './SessionReporter.js';

// ─── ObserveSession ───────────────────────────────────────────────────────────

/**
 * Observe session — human drives, agent watches.
 *
 * @example
 * ```ts
 * const session = new ObserveSession(page, context, eventBus, {
 *   output: 'both',
 *   outputDir: './talox-sessions',
 * });
 *
 * await session.start();
 * // Human browses...
 * // Browser close → report written automatically, 'sessionEnd' fires
 * ```
 */
export class ObserveSession {
  readonly sessionId:   string;
  readonly startedAt:   string;

  private readonly buffer:       AnnotationBuffer;
  private readonly interactions: TaloxInteraction[];
  private readonly injector:     OverlayInjector;
  private readonly reporter:     SessionReporter;
  private readonly eventBus:     EventBus<TaloxEventMap>;
  private readonly options:      Required<ObserveSessionOptions>;

  private startUrl:    string  = '';
  private finalised:  boolean  = false;

  constructor(
    private readonly page:    any,  // Playwright Page
    private readonly context: any,  // Playwright BrowserContext
    eventBus:                 EventBus<TaloxEventMap>,
    options:                  ObserveSessionOptions = {},
  ) {
    this.sessionId    = randomUUID();
    this.startedAt    = new Date().toISOString();
    this.buffer       = new AnnotationBuffer();
    this.interactions = [];
    this.eventBus     = eventBus;

    const wantsOverlay = options.overlay ?? true;
    const wantsRecord  = options.record  ?? wantsOverlay; // record defaults on if overlay is on

    this.options = {
      output:    options.output    ?? 'both',
      outputDir: options.outputDir ?? path.join(process.cwd(), 'talox-sessions'),
      headed:    options.headed    ?? true,
      overlay:   wantsOverlay,
      record:    wantsRecord,
    };

    this.injector = new OverlayInjector(
      this.sessionId,
      this.startedAt,
      this.buffer,
      this.eventBus,
      this.interactions,
      async () => {
        await this.finalize();
        await this.context.close();
      },
    );

    this.reporter = new SessionReporter(this.options.outputDir);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Start the observe session.
   * - Injects the overlay into the current page
   * - Wires navigation tracking
   * - Hooks browser close → auto-finalize
   */
  async start(): Promise<void> {
    this.startUrl = this.page.url?.() ?? '';

    // Inject overlay only if the overlay flag is enabled
    if (this.options.overlay) {
      await this.injector.inject(this.page);
    }

    // Track console errors
    this.page.on('console', (msg: any) => {
      if (msg.type() === 'error') {
        const last = this.interactions[this.interactions.length - 1];
        if (last) {
          last.consoleErrors.push(msg.text());
        }
        this.eventBus.emit('consoleError', {
          error: msg.text(),
          url:   this.page.url?.() ?? '',
        });
      }
    });

    // Track network failures
    this.page.on('requestfailed', (request: any) => {
      const failure = {
        url:    request.url(),
        status: request.failure()?.errorText ? -1 : 0,
        type:   request.resourceType(),
      };
      const last = this.interactions[this.interactions.length - 1];
      if (last) {
        last.networkFailures.push(failure);
      }
      this.eventBus.emit('networkError', {
        url:    failure.url,
        status: failure.status,
        type:   failure.type,
      });
    });

    // Track page navigations
    this.page.on('framenavigated', (frame: any) => {
      if (frame !== this.page.mainFrame?.()) return;
      const url = frame.url();
      if (!url || url === 'about:blank') return;

      const interaction: TaloxInteraction = {
        index:           this.interactions.length + 1,
        type:            'navigation',
        timestamp:       new Date().toISOString(),
        url,
        consoleErrors:   [],
        networkFailures: [],
      };
      this.interactions.push(interaction);
      this.eventBus.emit('navigation', { url, title: '' });
    });

    // Auto-finalize on browser close
    this.context.on('close', () => {
      this.finalize().catch((err: unknown) => {
        console.error('[Talox] Failed to finalize observe session:', err);
      });
    });

    console.info(`[Talox] Session started · ID: ${this.sessionId} · overlay=${this.options.overlay} · record=${this.options.record}`);
    if (this.options.overlay) {
      console.info('[Talox] Right-click anywhere in the browser to access the Talox overlay.');
    }
  }

  /**
   * Explicitly end the session and write the report.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async endSession(): Promise<void> {
    await this.finalize();
  }

  // ─── Report ──────────────────────────────────────────────────────────────────

  /**
   * Build and return the current session report without writing to disk.
   * Useful for testing or in-memory access before session end.
   */
  buildReport(): TaloxSessionReport {
    const endedAt    = new Date().toISOString();
    const durationMs = Date.now() - new Date(this.startedAt).getTime();
    const annotations: AnnotationEntry[] = [...this.buffer.getAll()];

    const summary: TaloxSessionSummary = {
      totalInteractions:   this.interactions.length,
      totalAnnotations:    annotations.length,
      totalConsoleErrors:  this.interactions.reduce((n, i) => n + i.consoleErrors.length, 0),
      totalNetworkFailures: this.interactions.reduce((n, i) => n + i.networkFailures.length, 0),
      annotationsByLabel:  this.buildLabelCounts(annotations),
    };

    return {
      id:           this.sessionId,
      startedAt:    this.startedAt,
      endedAt,
      durationMs,
      startUrl:     this.startUrl,
      interactions: [...this.interactions],
      annotations,
      summary,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async finalize(): Promise<void> {
    if (this.finalised) return;
    this.finalised = true;

    const report = this.buildReport();
    let reportPath: string = this.options.outputDir;

    if (this.options.record) {
      const paths = await this.reporter.write(report, this.options.output);
      reportPath  = paths.json ?? paths.markdown ?? this.options.outputDir;
    }

    this.eventBus.emit('sessionEnd', {
      sessionId:         this.sessionId,
      reportPath,
      durationMs:        report.durationMs,
      interactionCount:  report.summary.totalInteractions,
      annotationCount:   report.summary.totalAnnotations,
    });

    this.buffer.clear();

    console.info(
      `[Talox] Observe session ended · ${report.summary.totalInteractions} interactions · ` +
      `${report.summary.totalAnnotations} annotations · ${Math.round(report.durationMs / 1000)}s`,
    );
  }

  private buildLabelCounts(annotations: AnnotationEntry[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const annotation of annotations) {
      for (const label of annotation.labels) {
        counts[label] = (counts[label] ?? 0) + 1;
      }
    }
    return counts;
  }
}
