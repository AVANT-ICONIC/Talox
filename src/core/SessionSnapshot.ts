/**
 * @file SessionSnapshot.ts
 * @description Capture and restore browser session state across restarts.
 *
 * Used when `AdaptationEngine` escalates between headless ↔ headed mode:
 * the browser must be relaunched with new visibility settings, but the
 * agent's URL, cookies, localStorage, and scroll position must survive.
 *
 * ### Capture
 * Call `captureSessionSnapshot(page, context)` before stopping the browser.
 *
 * ### Restore
 * After relaunch and navigation, call `restoreSessionSnapshot(page, context, snap)`.
 * The restore navigates to the captured URL, injects cookies and localStorage,
 * then scrolls to the saved position.
 *
 * @example
 * ```ts
 * const snap = await captureSessionSnapshot(page, context);
 * await browserManager.close();
 * // ... relaunch with different headed setting ...
 * const newPage = await context.newPage();
 * await restoreSessionSnapshot(newPage, newContext, snap);
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionCookie {
  name:     string;
  value:    string;
  domain:   string;
  path:     string;
  expires:  number;
  httpOnly: boolean;
  secure:   boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface SessionSnapshot {
  /** URL captured before the restart. */
  url: string;
  /** Page title at capture time (for logging). */
  title: string;
  /** ISO timestamp of when the snapshot was taken. */
  capturedAt: string;
  /** Browser cookies from the context at capture time. */
  cookies: SessionCookie[];
  /**
   * localStorage key/value pairs from the captured URL's origin.
   * Empty object if localStorage is inaccessible (e.g. chrome-error:// pages).
   */
  localStorage: Record<string, string>;
  /**
   * sessionStorage key/value pairs from the captured URL's origin.
   * Empty object if sessionStorage is inaccessible.
   */
  sessionStorage: Record<string, string>;
  /** Horizontal scroll position in pixels. */
  scrollX: number;
  /** Vertical scroll position in pixels. */
  scrollY: number;
}

// ─── Capture ─────────────────────────────────────────────────────────────────

/**
 * Snapshot the browser session before a browser restart.
 *
 * @param page    Playwright page object (must be in a stable state, not mid-navigation).
 * @param context Playwright browser context (for cookie extraction).
 */
export async function captureSessionSnapshot(
  page:    any,
  context: any,
): Promise<SessionSnapshot> {
  const url        = page.url();
  const title      = await page.title().catch(() => '');
  const capturedAt = new Date().toISOString();

  // Cookies — from the context, not the page (captures all origins)
  let cookies: SessionCookie[] = [];
  try {
    const raw = await context.cookies();
    cookies = (raw ?? []).map((c: any) => ({
      name:     c.name,
      value:    c.value,
      domain:   c.domain,
      path:     c.path,
      expires:  c.expires ?? -1,
      httpOnly: c.httpOnly ?? false,
      secure:   c.secure ?? false,
      sameSite: c.sameSite ?? 'None',
    }));
  } catch { /* cookie extraction optional */ }

  // localStorage and sessionStorage — only reachable on http(s) origins
  let localStorage: Record<string, string>   = {};
  let sessionStorage: Record<string, string> = {};

  if (url.startsWith('http')) {
    try {
      localStorage = await page.evaluate(() => {
        const out: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k !== null) out[k] = window.localStorage.getItem(k) ?? '';
        }
        return out;
      });
    } catch { /* inaccessible — leave empty */ }

    try {
      sessionStorage = await page.evaluate(() => {
        const out: Record<string, string> = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k !== null) out[k] = window.sessionStorage.getItem(k) ?? '';
        }
        return out;
      });
    } catch { /* inaccessible — leave empty */ }
  }

  // Scroll position
  let scrollX = 0;
  let scrollY = 0;
  try {
    const pos = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    scrollX = pos.x;
    scrollY = pos.y;
  } catch { /* non-fatal */ }

  return { url, title, capturedAt, cookies, localStorage, sessionStorage, scrollX, scrollY };
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restore a previously captured session snapshot onto a fresh page.
 *
 * Order of operations:
 * 1. Add cookies to the context before navigation (so they're sent on the request).
 * 2. Navigate to the captured URL.
 * 3. Restore localStorage and sessionStorage.
 * 4. Scroll to the captured position.
 */
export async function restoreSessionSnapshot(
  page:     any,
  context:  any,
  snapshot: SessionSnapshot,
): Promise<void> {
  // 1. Inject cookies before navigation so they travel with the first request
  if (snapshot.cookies.length > 0) {
    try {
      await context.addCookies(snapshot.cookies);
    } catch { /* non-fatal — cookies may have expired or be cross-origin */ }
  }

  // 2. Navigate to the captured URL
  try {
    await page.goto(snapshot.url, { waitUntil: 'domcontentloaded' });
  } catch {
    // If navigation fails (e.g. redirect loop), try a direct goto without waiting
    try { await page.goto(snapshot.url); } catch { /* give up */ }
  }

  // 3. Restore localStorage
  const lsEntries = Object.entries(snapshot.localStorage);
  if (lsEntries.length > 0 && snapshot.url.startsWith('http')) {
    try {
      await page.evaluate((entries: [string, string][]) => {
        for (const [k, v] of entries) {
          try { window.localStorage.setItem(k, v); } catch { /* quota / security */ }
        }
      }, lsEntries);
    } catch { /* page may have navigated away */ }
  }

  // 4. Restore sessionStorage
  const ssEntries = Object.entries(snapshot.sessionStorage);
  if (ssEntries.length > 0 && snapshot.url.startsWith('http')) {
    try {
      await page.evaluate((entries: [string, string][]) => {
        for (const [k, v] of entries) {
          try { window.sessionStorage.setItem(k, v); } catch { /* quota / security */ }
        }
      }, ssEntries);
    } catch { /* non-fatal */ }
  }

  // 5. Restore scroll position
  if (snapshot.scrollX !== 0 || snapshot.scrollY !== 0) {
    try {
      await page.evaluate(
        ([x, y]: [number, number]) => window.scrollTo(x, y),
        [snapshot.scrollX, snapshot.scrollY] as [number, number],
      );
    } catch { /* non-fatal */ }
  }
}
