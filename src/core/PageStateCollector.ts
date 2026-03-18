import type { Page } from 'playwright-core';
import type { TaloxPageState, TaloxNode } from '../types/index.js';
import type { AnyTaloxMode } from '../types/modes.js';
import { resolveMode } from '../types/modes.js';
/** @internal backwards-compat alias used by PageStateCollector */
type TaloxMode = AnyTaloxMode;

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface RetryStats {
  attempts: number;
  axTreeAttempts: number;
  axTreeSuccesses: number;
  fallbackUsed: boolean;
  totalDelayMs: number;
  lastError?: string;
}

export interface PageStateCollectorOptions {
  retry?: Partial<RetryOptions>;
  useDomFallback?: boolean;
  domFallbackThreshold?: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 200,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

export class PageStateCollector {
  private consoleErrors: string[] = [];
  private failedRequests: Array<{ url: string; status: number; type?: string }> = [];
  private retryStats: RetryStats = {
    attempts: 0,
    axTreeAttempts: 0,
    axTreeSuccesses: 0,
    fallbackUsed: false,
    totalDelayMs: 0,
  };
  private options: Required<PageStateCollectorOptions>;

  constructor(private page: Page, options: PageStateCollectorOptions = {}) {
    this.options = {
      retry: { ...DEFAULT_RETRY_OPTIONS, ...options.retry },
      useDomFallback: options.useDomFallback ?? true,
      domFallbackThreshold: options.domFallbackThreshold ?? 10,
    };

    this.page.on('console', msg => {
      if (msg.type() === 'error') this.consoleErrors.push(msg.text());
    });

    // Track HTTP error responses (4xx / 5xx) for bot-detection heuristics
    this.page.on('response', (response: any) => {
      const status: number = response.status();
      if (status >= 400) {
        this.failedRequests.push({ url: response.url(), status });
      }
    });
  }

  getRetryStats(): Readonly<RetryStats> {
    return { ...this.retryStats };
  }

  resetRetryStats(): void {
    this.retryStats = {
      attempts: 0,
      axTreeAttempts: 0,
      axTreeSuccesses: 0,
      fallbackUsed: false,
      totalDelayMs: 0,
    };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }

  private calculateBackoff(attempt: number): number {
    const { initialDelayMs, maxDelayMs, backoffMultiplier } = this.options.retry;
    const delay = Math.min(
      (initialDelayMs ?? DEFAULT_RETRY_OPTIONS.initialDelayMs) * Math.pow(backoffMultiplier ?? DEFAULT_RETRY_OPTIONS.backoffMultiplier, attempt),
      maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs
    );
    return delay;
  }

  private async collectDomFallback(): Promise<TaloxNode[]> {
    const selectors = [
      'a', 'button', 'input', 'select', 'textarea',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[tabindex]:not([tabindex="-1"])', 'area'
    ];
    
    const elements = await this.page.$$(selectors.join(', '));
    const nodes: TaloxNode[] = [];
    
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el) continue;
      try {
        const isVisible = await el.isVisible();
        if (!isVisible) continue;
        
        const box = await el.boundingBox();
        if (!box || box.width === 0 || box.height === 0) continue;
        
        const tagName = await el.evaluate(e => e.tagName.toLowerCase());
        const text = await el.evaluate(e => {
          if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
            return (e as HTMLInputElement).placeholder || (e as HTMLInputElement).value || '';
          }
          return e.textContent?.trim().slice(0, 100) || '';
        });
        
        const role = await el.evaluate(e => {
          if (e.getAttribute('role')) return e.getAttribute('role');
          if (e.tagName === 'A') return 'link';
          if (e.tagName === 'BUTTON') return 'button';
          if (e.tagName === 'INPUT') return 'textbox';
          if (e.tagName === 'SELECT') return 'combobox';
          if (e.tagName === 'TEXTAREA') return 'textbox';
          return 'unknown';
        });
        
        const isDisabled = await el.isDisabled();
        
        nodes.push({
          id: `dom-fallback-${i}`,
          role: role || 'unknown',
          name: text,
          description: isDisabled ? 'disabled' : '',
          boundingBox: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
          },
          attributes: {
            tag: tagName,
            ...(isDisabled && { disabled: 'true' })
          }
        });
      } catch {
        // Skip elements that can't be analyzed
      }
    }
    
    return nodes;
  }

  private async collectFromShadowDom(): Promise<any[]> {
    try {
      return await this.page.evaluate(() => {
      const interactiveSelectors = [
        'a', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="menuitem"]',
        '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
        '[tabindex]:not([tabindex="-1"])'
      ];

      const results: Array<{
        id: string;
        tagName: string;
        boundingBox: { x: number; y: number; width: number; height: number };
        inShadowDom: boolean;
        shadowRootPath: string[];
      }> = [];

      function queryShadowHosts(root: Document | ShadowRoot, path: string[] = []): void {
        const shadowHosts = Array.from(root.querySelectorAll('*'));
        
        for (const host of shadowHosts) {
          if (host.shadowRoot) {
            const currentPath = [...path, host.tagName.toLowerCase()];
            const shadowRoot = host.shadowRoot;
            
            for (const selector of interactiveSelectors) {
              try {
                const elements = Array.from(shadowRoot.querySelectorAll(selector));
                for (const el of elements) {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    results.push({
                      id: `shadow-${results.length}`,
                      tagName: el.tagName.toLowerCase(),
                      boundingBox: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height
                      },
                      inShadowDom: true,
                      shadowRootPath: currentPath
                    });
                  }
                }
              } catch (e) {
                // Skip selectors that may not be valid in this context
              }
            }

            queryShadowHosts(shadowRoot, currentPath);
          }
        }
      }

      queryShadowHosts(document);
      return results;
      });
    } catch (e) {
      return [];
    }
  }

  private mergeInteractiveElements(
    domElements: any[], 
    shadowElements: any[]
  ): any[] {
    const merged = [...domElements];
    const maxId = merged.length > 0 
      ? Math.max(...merged.map((el: any) => {
          const match = el.id.match(/dom-(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        }))
      : 0;

    for (let i = 0; i < shadowElements.length; i++) {
      const shadowEl = shadowElements[i];
      merged.push({
        id: `dom-${maxId + i + 1}`,
        tagName: shadowEl.tagName,
        boundingBox: shadowEl.boundingBox,
        inShadowDom: shadowEl.inShadowDom,
        shadowRootPath: shadowEl.shadowRootPath
      });
    }

    return merged;
  }

  private async collectInteractiveElementsViaDom(): Promise<any[]> {
    return this.page.$$eval('a, button, input, select, textarea, [role="button"]', elements => {
      return elements.map((el, i) => {
        const rect = el.getBoundingClientRect();
        return {
          id: `dom-${i}`,
          tagName: el.tagName.toLowerCase(),
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          }
        };
      });
    });
  }

  private flattenAXTree(node: any, result: TaloxNode[] = []) {
    // If it has a role, it's a candidate
    if (node.role) {
        const box = node.box || node.boundingBox;
        if (box) {
            const newNode: TaloxNode = {
                id: `ax-${result.length}`,
                role: node.role,
                name: node.name || '',
                description: node.description || '',
                boundingBox: {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height
                }
            };
            if (node.value !== undefined) {
                newNode.attributes = { value: String(node.value) };
            }
            result.push(newNode);
        }
    }

    if (node.children) {
      for (const child of node.children) {
        this.flattenAXTree(child, result);
      }
    }
    return result;
  }

  async collect(mode: TaloxMode = 'browse'): Promise<TaloxPageState> {
    const url = this.page.url();
    const title = await this.page.title();
    
    this.retryStats.attempts++;
    
    let nodes: TaloxNode[] = [];
    let axSnapshot: any = null;
    let axTreeError: Error | null = null;
    let shouldUseFallback = false;
    const { maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries } = this.options.retry;

    // Progressive State Collection: Retry if node count is below threshold
    const nodeThreshold = this.options.domFallbackThreshold;
    let collectionAttempts = 0;
    const maxCollectionAttempts = 3;

    while (collectionAttempts < maxCollectionAttempts) {
      nodes = [];
      axSnapshot = null;
      axTreeError = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        this.retryStats.axTreeAttempts++;
        
        try {
          const page = this.page as any;
          if (attempt > 0) {
            const delay = this.calculateBackoff(attempt - 1);
            this.retryStats.totalDelayMs += delay;
            await this.sleep(delay);
          }
          
          try {
            // @ts-ignore - accessibility might not be in types
            axSnapshot = await this.page.accessibility?.snapshot();
          } catch (axErr) {
            axTreeError = axErr as Error;
            axSnapshot = null;
          }
          
          if (axSnapshot) {
            nodes = this.flattenAXTree(axSnapshot);
            this.retryStats.axTreeSuccesses++;
            break;
          }
          
          axTreeError = new Error('AX-Tree snapshot returned null');
        } catch (err) {
          axTreeError = err as Error;
          this.retryStats.lastError = axTreeError.message;
        }
      }

      shouldUseFallback = this.options.useDomFallback && (
        nodes.length < nodeThreshold ||
        axTreeError !== null ||
        axSnapshot === null
      );

      if (shouldUseFallback) {
        nodes = await this.collectDomFallback();
        this.retryStats.fallbackUsed = true;
      }

      // If we found enough nodes, or we've tried enough, break
      if (nodes.length >= nodeThreshold || collectionAttempts === maxCollectionAttempts - 1) {
        break;
      }

      // Wait for 500ms before retrying (SPA hydration/loading gap)
      await this.sleep(500);
      collectionAttempts++;
    }

    const interactiveElements = shouldUseFallback
      ? nodes.map((n, i) => ({
          id: `dom-${i}`,
          tagName: (n.attributes?.tag as string) || 'unknown',
          boundingBox: n.boundingBox
        }))
      : await this.collectInteractiveElementsViaDom();

    const shadowDomElements = await this.collectFromShadowDom();
    const mergedInteractiveElements = this.mergeInteractiveElements(
      interactiveElements,
      shadowDomElements
    );
    
    return {
      url,
      title,
      timestamp: new Date().toISOString(),
      mode: resolveMode(mode),
      console: { errors: [...this.consoleErrors] },
      network: { failedRequests: [...this.failedRequests] },
      nodes,
      interactiveElements: mergedInteractiveElements,
      bugs: [],
    };
  }
}
