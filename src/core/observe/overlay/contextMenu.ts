/**
 * @file contextMenu.ts
 * @description Talox overlay right-click context menu.
 *
 * Intercepts right-click (`contextmenu`) events and replaces the native browser
 * context menu with a minimal Talox-branded overlay menu containing three actions:
 *
 * - 🔍 Comment Mode   → activates the element inspector
 * - 📸 Snapshot       → requests a page snapshot from Node.js
 * - ✅ End Session    → ends the observe session after confirmation
 *
 * This file runs inside the browser page context (injected via addInitScript).
 */

import { taloxEmit } from './bridge.js';

// ─── Styles ───────────────────────────────────────────────────────────────────

const MENU_STYLES = `
  #talox-context-menu {
    position: fixed;
    z-index: 2147483647;
    min-width: 180px;
    background: #18181b;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    padding: 4px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    color: #fafafa;
    user-select: none;
    animation: talox-fade-in 120ms ease;
  }

  @keyframes talox-fade-in {
    from { opacity: 0; transform: scale(0.96); }
    to   { opacity: 1; transform: scale(1); }
  }

  .talox-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    cursor: pointer;
    transition: background 80ms ease;
    white-space: nowrap;
  }

  .talox-menu-item:hover {
    background: #27272a;
  }

  .talox-menu-item:active {
    background: #3f3f46;
  }

  .talox-menu-item--danger {
    color: #fecaca;
  }

  .talox-menu-item--danger:hover {
    background: rgba(127, 29, 29, 0.45);
  }

  .talox-menu-icon {
    font-size: 14px;
    width: 18px;
    text-align: center;
  }

  .talox-menu-divider {
    height: 1px;
    background: #3f3f46;
    margin: 4px 0;
  }

  .talox-menu-label {
    font-weight: 500;
  }

  .talox-menu-badge {
    margin-left: auto;
    font-size: 10px;
    color: #71717a;
    background: #27272a;
    border-radius: 4px;
    padding: 1px 5px;
  }
`;

// ─── Context Menu ─────────────────────────────────────────────────────────────

/**
 * Installs the Talox context menu overlay.
 * Call once during page init. The menu is created on-demand and destroyed
 * after each interaction to keep the DOM clean.
 *
 * @param onCommentMode - Callback invoked when "Comment Mode" is selected.
 */
export function installContextMenu(onCommentMode: () => void): void {
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, onCommentMode);
  }, true);

  // Dismiss on click outside the menu
  document.addEventListener('click', (e: MouseEvent) => {
    if (!(e.target as Element).closest?.('#talox-context-menu')) dismissMenu();
  }, true);
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismissMenu();
  });
}

// ─── Private ─────────────────────────────────────────────────────────────────

function showMenu(x: number, y: number, onCommentMode: () => void): void {
  injectStyles();
  dismissMenu();

  const menu = document.createElement('div');
  menu.id = 'talox-context-menu';

  menu.innerHTML = `
    <div class="talox-menu-item" id="talox-menu-comment">
      <span class="talox-menu-icon">🔍</span>
      <span class="talox-menu-label">Comment Mode</span>
    </div>
    <div class="talox-menu-item" id="talox-menu-snapshot">
      <span class="talox-menu-icon">📸</span>
      <span class="talox-menu-label">Snapshot</span>
    </div>
    <div class="talox-menu-divider"></div>
    <div class="talox-menu-item talox-menu-item--danger" id="talox-menu-end">
      <span class="talox-menu-icon">✅</span>
      <span class="talox-menu-label">End Session & Report</span>
    </div>
  `;

  // Position within viewport bounds
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.left = `${Math.min(x, vw - rect.width - 8)}px`;
  menu.style.top  = `${Math.min(y, vh - rect.height - 8)}px`;

  // ── Handlers ──────────────────────────────────────────────────────────────
  document.getElementById('talox-menu-comment')?.addEventListener('click', () => {
    dismissMenu();
    onCommentMode();
  });

  document.getElementById('talox-menu-snapshot')?.addEventListener('click', () => {
    dismissMenu();
    taloxEmit('snapshot:request', {
      url:       window.location.href,
      timestamp: new Date().toISOString(),
    });
  });

  document.getElementById('talox-menu-end')?.addEventListener('click', () => {
    dismissMenu();
    taloxEmit('session:end', {});
  });
}

function dismissMenu(): void {
  document.getElementById('talox-context-menu')?.remove();
}

function injectStyles(): void {
  if (document.getElementById('talox-context-menu-styles')) return;
  const style = document.createElement('style');
  style.id = 'talox-context-menu-styles';
  style.textContent = MENU_STYLES;
  document.head.appendChild(style);
}
