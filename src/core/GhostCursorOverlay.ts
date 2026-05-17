import type { Page } from "playwright-core";
import type { CursorStepCallback } from "./HumanMouse.js";

/**
 * Configuration for the ghost cursor overlay.
 */
export interface GhostCursorOptions {
	/** Primary dot color (CSS). Default: cyan */
	color: string;
	/** Dot radius in px. Default: 8 */
	radius: number;
	/** Trail length (number of previous positions). Default: 12 */
	trailLength: number;
	/** Trail dot base opacity (fades from this to 0). Default: 0.4 */
	trailOpacity: number;
	/** Glow blur radius. Default: 16 */
	glowRadius: number;
	/** Click ripple duration ms. Default: 400 */
	clickRippleDuration: number;
}

const DEFAULT_OPTIONS: GhostCursorOptions = {
	color: "cyan",
	radius: 8,
	trailLength: 12,
	trailOpacity: 0.4,
	glowRadius: 16,
	clickRippleDuration: 400,
};

/**
 * Injects a visible ghost cursor overlay into headed browser pages.
 *
 * The overlay renders:
 * - A glowing cyan dot at the current cursor position
 * - A fading trail of previous positions (shows the bezier curve path)
 * - A ripple effect on clicks
 *
 * Uses `page.addInitScript()` for SPA resilience and a CDP-exposed
 * function (`__taloxMoveCursor__`) for real-time position updates.
 */
export class GhostCursorOverlay {
	private readonly options: GhostCursorOptions;
	private readonly injectedPages = new WeakSet<object>();

	constructor(options: Partial<GhostCursorOptions> = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
	 * Inject the cursor overlay into a page. Idempotent per page.
	 */
	async inject(page: Page): Promise<void> {
		if (this.injectedPages.has(page as object)) return;

		const opts = this.options;

		// Expose the move function that the CursorStepCallback calls
		await page.exposeFunction("__taloxMoveCursor__", (x: number, y: number) => {
			// The actual DOM update is done via evaluate below — this function
			// just signals the page. We use evaluate for the real DOM work.
		});

		// The overlay script — runs before page JS, persists across navigations
		await page.addInitScript(`
			(function() {
				// Guard against double-injection
				if (window.__taloxGhostCursor__) return;
				window.__taloxGhostCursor__ = true;

				// ── SVG overlay container ──
				const ns = 'http://www.w3.org/2000/svg';
				let svg = document.createElementNS(ns, 'svg');
				svg.setAttribute('id', 'talox-cursor-overlay');
				svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';
				document.documentElement.appendChild(svg);

				// ── Defs for glow filter ──
				const defs = document.createElementNS(ns, 'defs');
				const filter = document.createElementNS(ns, 'filter');
				filter.setAttribute('id', 'talox-glow');
				filter.setAttribute('x', '-50%');
				filter.setAttribute('y', '-50%');
				filter.setAttribute('width', '200%');
				filter.setAttribute('height', '200%');
				const blur = document.createElementNS(ns, 'feGaussianBlur');
				blur.setAttribute('stdDeviation', '${opts.glowRadius}');
				blur.setAttribute('result', 'blur');
				const merge = document.createElementNS(ns, 'feMerge');
				const mn1 = document.createElementNS(ns, 'feMergeNode');
				mn1.setAttribute('in', 'blur');
				const mn2 = document.createElementNS(ns, 'feMergeNode');
				mn2.setAttribute('in', 'SourceGraphic');
				merge.appendChild(mn1);
				merge.appendChild(mn2);
				filter.appendChild(blur);
				filter.appendChild(merge);
				defs.appendChild(filter);
				svg.appendChild(defs);

				// ── Trail dots pool ──
				const TRAIL_LEN = ${opts.trailLength};
				const trail = [];
				const trailDots = [];
				for (let i = 0; i < TRAIL_LEN; i++) {
					const c = document.createElementNS(ns, 'circle');
					c.setAttribute('r', '${opts.radius}' * (1 - i / TRAIL_LEN) * 0.6);
					c.setAttribute('fill', '${opts.color}');
					c.setAttribute('opacity', '0');
					c.style.transition = 'opacity 0.3s ease-out';
					svg.appendChild(c);
					trailDots.push(c);
				}

				// ── Main cursor dot ──
				const dot = document.createElementNS(ns, 'circle');
				dot.setAttribute('r', '${opts.radius}');
				dot.setAttribute('fill', '${opts.color}');
				dot.setAttribute('opacity', '0');
				dot.setAttribute('filter', 'url(#talox-glow)');
				svg.appendChild(dot);

				// ── Inner bright core ──
				const core = document.createElementNS(ns, 'circle');
				core.setAttribute('r', '${opts.radius}' * 0.4);
				core.setAttribute('fill', 'white');
				core.setAttribute('opacity', '0');
				svg.appendChild(core);

				// ── Ripple pool ──
				const ripples = [];
				function spawnRipple(x, y) {
					const r = document.createElementNS(ns, 'circle');
					r.setAttribute('cx', x);
					r.setAttribute('cy', y);
					r.setAttribute('r', '${opts.radius}');
					r.setAttribute('fill', 'none');
					r.setAttribute('stroke', '${opts.color}');
					r.setAttribute('stroke-width', '2');
					r.setAttribute('opacity', '0.8');
					svg.appendChild(r);
					ripples.push({ el: r, start: performance.now() });
				}

				// ── Animation loop ──
				let animating = false;
				function tick(now) {
					// Animate ripples
					for (let i = ripples.length - 1; i >= 0; i--) {
						const rp = ripples[i];
						const elapsed = now - rp.start;
						const duration = ${opts.clickRippleDuration};
						if (elapsed > duration) {
							svg.removeChild(rp.el);
							ripples.splice(i, 1);
							continue;
						}
						const t = elapsed / duration;
						const ease = 1 - Math.pow(1 - t, 3);
						rp.el.setAttribute('r', '${opts.radius}' + ease * 30);
						rp.el.setAttribute('opacity', String(0.8 * (1 - t)));
						rp.el.setAttribute('stroke-width', String(2 * (1 - t)));
					}

					if (ripples.length > 0) {
						requestAnimationFrame(tick);
					} else {
						animating = false;
					}
				}
				function startAnim() {
					if (!animating) {
						animating = true;
						requestAnimationFrame(tick);
					}
				}

				// ── Position update ──
				let initialized = false;
				window.__taloxUpdateCursor__ = function(x, y, clicked) {
					// Show cursor on first move
					if (!initialized) {
						dot.setAttribute('opacity', '0.9');
						core.setAttribute('opacity', '0.95');
						initialized = true;
					}

					// Update trail
					trail.unshift({ x, y });
					if (trail.length > TRAIL_LEN) trail.length = TRAIL_LEN;

					for (let i = 0; i < TRAIL_LEN; i++) {
						const td = trailDots[i];
						if (i < trail.length) {
							const p = trail[i];
							td.setAttribute('cx', p.x);
							td.setAttribute('cy', p.y);
							td.setAttribute('opacity', String(${opts.trailOpacity} * (1 - i / TRAIL_LEN)));
						} else {
							td.setAttribute('opacity', '0');
						}
					}

					// Update main dot
					dot.setAttribute('cx', x);
					dot.setAttribute('cy', y);
					core.setAttribute('cx', x);
					core.setAttribute('cy', y);

					// Ripple on click
					if (clicked) {
						spawnRipple(x, y);
						startAnim();
					}
				};

				// Re-inject SVG on SPA navigations if lost
				const observer = new MutationObserver(function() {
					if (!document.getElementById('talox-cursor-overlay')) {
						document.documentElement.appendChild(svg);
					}
				});
				observer.observe(document.documentElement, { childList: true });
			})();
		`);

		this.injectedPages.add(page as object);
	}

	/**
	 * Create a `CursorStepCallback` wired to this overlay.
	 * Call this AFTER `inject()` — the page must have the overlay script.
	 */
	createCallback(page: Page): CursorStepCallback {
		return async (x: number, y: number) => {
			try {
				await page.evaluate(
					([px, py]) => {
						const update = window.__taloxUpdateCursor__;
						if (typeof update === "function") {
							update(px, py, false);
						}
					},
					[x, y] as const,
				);
			} catch {
				// Page navigated away or closed — ignore
			}
		};
	}

	/**
	 * Fire a click ripple at the given position.
	 */
	async clickRipple(page: Page, x: number, y: number): Promise<void> {
		try {
			await page.evaluate(
				([px, py]) => {
					const update = window.__taloxUpdateCursor__;
					if (typeof update === "function") {
						update(px, py, true);
					}
				},
				[x, y] as const,
			);
		} catch {
			// Page navigated away or closed — ignore
		}
	}
}
