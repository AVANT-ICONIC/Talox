/**
 * @file elementInspector.ts
 * @description Talox overlay element inspector (Comment Mode picker).
 *
 * When Comment Mode is activated, the cursor becomes a crosshair and elements
 * are highlighted with a blue outline as the human hovers. Clicking an element
 * captures its identity (tag, role, text, selector, bounding box) and hands
 * control to the annotation modal.
 *
 * This file runs inside the browser page context (injected via addInitScript).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapturedElement {
  tag:         string;
  role?:       string;
  text?:       string;
  selector:    string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const INSPECTOR_STYLES = `
  body.talox-inspect-mode {
    cursor: crosshair !important;
  }

  body.talox-inspect-mode * {
    cursor: crosshair !important;
  }

  .talox-inspect-highlight {
    outline: 2px solid #3B82F6 !important;
    outline-offset: 2px !important;
    background-color: rgba(59, 130, 246, 0.06) !important;
    transition: outline 60ms ease, background-color 60ms ease;
  }

  #talox-inspect-tooltip {
    position: fixed;
    z-index: 2147483646;
    background: #18181b;
    color: #fafafa;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid #3f3f46;
    pointer-events: none;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
`;

// ─── ElementInspector ────────────────────────────────────────────────────────

/**
 * Activates the element inspector.
 *
 * @param onElementSelected - Callback invoked with the captured element when
 *                            the human clicks to select one.
 */
export function activateInspector(
  onElementSelected: (element: CapturedElement) => void,
): void {
  injectStyles();
  document.body.classList.add('talox-inspect-mode');
  showToast('🔍 Comment Mode — click an element to annotate  [Esc to cancel]');

  let highlighted: Element | null = null;

  const handleMouseOver = (e: MouseEvent): void => {
    const target = e.target as Element;
    if (target === document.body || target === document.documentElement) return;
    if (target.id === 'talox-inspect-tooltip') return;

    if (highlighted && highlighted !== target) {
      highlighted.classList.remove('talox-inspect-highlight');
    }
    target.classList.add('talox-inspect-highlight');
    highlighted = target;
    updateTooltip(e.clientX, e.clientY, getElementLabel(target));
  };

  const handleMouseOut = (e: MouseEvent): void => {
    const target = e.target as Element;
    target.classList.remove('talox-inspect-highlight');
    if (highlighted === target) highlighted = null;
    removeTooltip();
  };

  const handleClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as Element;
    deactivate();

    const captured = captureElement(target, e);
    onElementSelected(captured);
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      deactivate();
      showToast('Comment Mode cancelled');
    }
  };

  function deactivate(): void {
    document.body.classList.remove('talox-inspect-mode');
    highlighted?.classList.remove('talox-inspect-highlight');
    removeTooltip();
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout',  handleMouseOut,  true);
    document.removeEventListener('click',     handleClick,     true);
    document.removeEventListener('keydown',   handleKeyDown,   true);
  }

  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout',  handleMouseOut,  true);
  document.addEventListener('click',     handleClick,     true);
  document.addEventListener('keydown',   handleKeyDown,   true);
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

function captureElement(el: Element, _event: MouseEvent): CapturedElement {
  const rect      = el.getBoundingClientRect();
  const tag       = el.tagName.toLowerCase();
  const rawText   = el.textContent?.trim().slice(0, 120);
  const textEntry = rawText ? { text: rawText } : {};

  return {
    tag,
    role:     el.getAttribute('role') ?? inferRole(el),
    selector: generateSelector(el),
    boundingBox: {
      x:      rect.left + window.scrollX,
      y:      rect.top  + window.scrollY,
      width:  rect.width,
      height: rect.height,
    },
    ...textEntry,
  };
}

/**
 * Generates the most specific unique CSS selector for a given element.
 * Prefers `id` → `data-testid` → `aria-label` → tag+class → nth-child fallback.
 */
function generateSelector(el: Element): string {
  // ID is always unique
  if (el.id) return `#${CSS.escape(el.id)}`;

  // data-testid is reliable for test-annotated elements
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

  // aria-label for accessible elements
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;

  // Tag + first class
  const tag = el.tagName.toLowerCase();
  if (el.classList.length > 0) {
    const firstClass = CSS.escape(el.classList[0]!);
    const selector   = `${tag}.${firstClass}`;
    // Verify uniqueness
    if (document.querySelectorAll(selector).length === 1) return selector;
  }

  // nth-child path fallback (always unique)
  return buildNthChildPath(el);
}

function buildNthChildPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    const parent: Element | null = current.parentElement;
    const tag       = current.tagName.toLowerCase();
    const index     = parent
      ? Array.from(parent.children).indexOf(current) + 1
      : 1;
    parts.unshift(`${tag}:nth-child(${index})`);
    current = parent;
  }

  return parts.join(' > ');
}

function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const roleMap: Record<string, string> = {
    a:        'link',
    button:   'button',
    input:    'textbox',
    select:   'combobox',
    textarea: 'textbox',
    img:      'img',
    h1: 'heading', h2: 'heading', h3: 'heading',
    nav: 'navigation',
    main: 'main',
  };
  return roleMap[tag] ?? tag;
}

function getElementLabel(el: Element): string {
  const tag  = el.tagName.toLowerCase();
  const text = el.textContent?.trim().slice(0, 40);
  return text ? `<${tag}> "${text}"` : `<${tag}>`;
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function updateTooltip(x: number, y: number, label: string): void {
  let tooltip = document.getElementById('talox-inspect-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'talox-inspect-tooltip';
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = label;
  tooltip.style.left = `${Math.min(x + 14, window.innerWidth - 200)}px`;
  tooltip.style.top  = `${Math.max(y - 28, 8)}px`;
}

function removeTooltip(): void {
  document.getElementById('talox-inspect-tooltip')?.remove();
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(message: string, durationMs = 2500): void {
  const existing = document.getElementById('talox-toast');
  existing?.remove();

  const toast = document.createElement('div');
  toast.id = 'talox-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: #18181b;
    color: #fafafa;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    padding: 10px 18px;
    border-radius: 8px;
    border: 1px solid #3f3f46;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    pointer-events: none;
    animation: talox-fade-in 150ms ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

// ─── Style Injection ─────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById('talox-inspector-styles')) return;
  const style = document.createElement('style');
  style.id = 'talox-inspector-styles';
  style.textContent = INSPECTOR_STYLES;
  document.head.appendChild(style);
}
