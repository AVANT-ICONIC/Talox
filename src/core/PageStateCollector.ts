import { load as loadYaml } from "js-yaml";
import type { Page, Response } from "playwright-core";
import type { CursorDetectionMethod, TaloxNode, TaloxPageState } from "../types/index.js";

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

/**
 * Collects the full state of a Playwright page: URL, title, accessibility-tree
 * nodes (with retry and DOM-based fallback), interactive elements (including
 * shadow-DOM traversal), console errors, and failed network requests.
 * Progressive retries handle SPA hydration timing gaps.
 */
export class PageStateCollector {
	private readonly consoleErrors: string[] = [];
	private lastState: TaloxPageState | null = null;
	private readonly failedRequests: Array<{ url: string; status: number; type?: string }> = [];
	private retryStats: RetryStats = {
		attempts: 0,
		axTreeAttempts: 0,
		axTreeSuccesses: 0,
		fallbackUsed: false,
		totalDelayMs: 0,
	};
	private readonly options: Required<PageStateCollectorOptions>;

	constructor(
		private readonly page: Page,
		options: PageStateCollectorOptions = {},
	) {
		this.options = {
			retry: { ...DEFAULT_RETRY_OPTIONS, ...options.retry },
			useDomFallback: options.useDomFallback ?? true,
			domFallbackThreshold: options.domFallbackThreshold ?? 10,
		};

		this.page.on("console", (msg) => {
			try {
				if (msg.type() === "error") this.consoleErrors.push(msg.text());
			} catch {
				/* page may be closing */
			}
		});

		// Track HTTP error responses (4xx / 5xx) for bot-detection heuristics
		this.page.on("response", (response: Response) => {
			try {
				const status: number = response.status();
				if (status >= 400) {
					this.failedRequests.push({ url: response.url(), status, type: response.request().resourceType() });
				}
			} catch {
				/* page may be closing */
			}
		});
	}

	/** Expose the Playwright page for internal consumers (e.g. PerceptionStack screenshots). */
	getPage(): Page {
		return this.page;
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
		await new Promise((r) => setTimeout(r, ms));
	}

	private calculateBackoff(attempt: number): number {
		const { initialDelayMs, maxDelayMs, backoffMultiplier } = this.options.retry;
		const delay = Math.min(
			(initialDelayMs ?? DEFAULT_RETRY_OPTIONS.initialDelayMs) *
				(backoffMultiplier ?? DEFAULT_RETRY_OPTIONS.backoffMultiplier) ** attempt,
			maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs,
		);
		return delay;
	}

	private static readonly DOM_FALLBACK_SELECTORS = [
		"a",
		"button",
		"input",
		"select",
		"textarea",
		'[role="button"]',
		'[role="link"]',
		'[role="menuitem"]',
		'[tabindex]:not([tabindex="-1"])',
		"area",
	];

	private async collectDomFallback(): Promise<TaloxNode[]> {
		const elements = await this.page.$$(PageStateCollector.DOM_FALLBACK_SELECTORS.join(", "));
		const nodes: TaloxNode[] = [];

		for (let i = 0; i < elements.length; i++) {
			const el = elements[i];
			if (!el) continue;
			try {
				const node = await this.tryBuildDomFallbackNode(el, i);
				if (node) nodes.push(node);
			} catch {
				// Skip elements that can't be analyzed
			}
		}

		return nodes;
	}

	private async tryBuildDomFallbackNode(el: any, index: number): Promise<TaloxNode | null> {
		// Skip Talox-injected overlay elements
		const elId = await el.evaluate((e: any) => e.id || "");
		if (elId.startsWith("__talox")) return null;
		// Skip aria-hidden/presentation elements
		const shouldSkip = await el.evaluate(
			(e: any) => e.getAttribute("aria-hidden") === "true" || e.getAttribute("role") === "presentation",
		);
		if (shouldSkip) return null;

		const isVisible = await el.isVisible();
		if (!isVisible) return null;

		const box = await el.boundingBox();
		if (!box || box.width === 0 || box.height === 0) return null;

		const tagName = await el.evaluate((e: any) => e.tagName.toLowerCase());
		const text = await el.evaluate((e: any) => {
			if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) {
				return (
					(e as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
					(e as HTMLInputElement).placeholder ||
					e.getAttribute("aria-label")?.trim() ||
					(e as HTMLInputElement).value ||
					""
				);
			}
			return e.textContent?.trim().slice(0, 100) || "";
		});

		const role = await el.evaluate((e: any) => {
			if (e.getAttribute("role")) return e.getAttribute("role");
			if (e.tagName === "A") return "link";
			if (e.tagName === "BUTTON") return "button";
			if (e.tagName === "INPUT") return "textbox";
			if (e.tagName === "SELECT") return "combobox";
			if (e.tagName === "TEXTAREA") return "textbox";
			return "unknown";
		});

		const selector = await el.evaluate((e: any) => {
			if (e.id) return `#${CSS.escape(e.id)}`;
			if (e.getAttribute("name")) return `${e.tagName.toLowerCase()}[name="${e.getAttribute("name")}"]`;
			if (e.getAttribute("aria-label"))
				return `${e.tagName.toLowerCase()}[aria-label="${CSS.escape(e.getAttribute("aria-label"))}"]`;
			if (e.getAttribute("placeholder"))
				return `${e.tagName.toLowerCase()}[placeholder="${CSS.escape(e.getAttribute("placeholder"))}"]`;
			if (e.getAttribute("type")) return `${e.tagName.toLowerCase()}[type="${e.getAttribute("type")}"]`;
			const parent = e.parentElement;
			if (parent) {
				const siblings = Array.from(parent.children).filter((c: any) => c.tagName === e.tagName);
				if (siblings.length === 1) return e.tagName.toLowerCase();
				const idx = siblings.indexOf(e) + 1;
				return `${e.tagName.toLowerCase()}:nth-of-type(${idx})`;
			}
			return e.tagName.toLowerCase();
		});

		const isDisabled = await el.isDisabled();

		return {
			id: selector || `dom-fallback-${index}`,
			role: role || "unknown",
			name: text,
			description: isDisabled ? "disabled" : "",
			boundingBox: {
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height,
			},
			attributes: {
				tag: tagName,
				...(isDisabled && { disabled: "true" }),
			},
			trust: "first-party",
		};
	}

	private async collectFromShadowDom(): Promise<any[]> {
		try {
			return await this.page.evaluate(() => {
				const interactiveSelectors = [
					"a",
					"button",
					"input",
					"select",
					"textarea",
					'[role="button"]',
					'[role="link"]',
					'[role="menuitem"]',
					'[role="checkbox"]',
					'[role="radio"]',
					'[role="switch"]',
					'[tabindex]:not([tabindex="-1"])',
				];

				const results: Array<{
					id: string;
					tagName: string;
					boundingBox: { x: number; y: number; width: number; height: number };
					inShadowDom: boolean;
					shadowRootPath: string[];
				}> = [];

				function collectVisibleElements(shadowRoot: ShadowRoot, currentPath: string[]): void {
					for (const selector of interactiveSelectors) {
						try {
							const elements = Array.from(shadowRoot.querySelectorAll(selector));
							for (const el of elements) {
								const rect = el.getBoundingClientRect();
								if (rect.width > 0 && rect.height > 0) {
									results.push({
										id: `shadow-${results.length}`,
										tagName: el.tagName.toLowerCase(),
										boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
										inShadowDom: true,
										shadowRootPath: currentPath,
									});
								}
							}
						} catch (error_) {
							/* NOSONAR */
							// intentionally ignored: Skip selectors that may not be valid in this context
						}
					}
				}

				function queryShadowHosts(root: Document | ShadowRoot, path: string[] = []): void {
					const shadowHosts = Array.from(root.querySelectorAll("*"));
					for (const host of shadowHosts) {
						if (host.shadowRoot) {
							const currentPath = [...path, host.tagName.toLowerCase()];
							collectVisibleElements(host.shadowRoot, currentPath);
							queryShadowHosts(host.shadowRoot, currentPath);
						}
					}
				}

				queryShadowHosts(document);
				return results;
			});
		} catch (error_) {
			/* NOSONAR */
			// intentionally ignored: DOM query failure returns empty result
			return [];
		}
	}

	private mergeInteractiveElements(domElements: any[], shadowElements: any[]): any[] {
		const merged = [...domElements];
		const maxId =
			merged.length > 0
				? Math.max(
						...merged.map((el: any) => {
							const match = el.id.match(/dom-(\d+)/);
							return match ? Number.parseInt(match[1], 10) : 0;
						}),
					)
				: 0;

		for (let i = 0; i < shadowElements.length; i++) {
			const shadowEl = shadowElements[i];
			merged.push({
				id: `dom-${maxId + i + 1}`,
				tagName: shadowEl.tagName,
				boundingBox: shadowEl.boundingBox,
				inShadowDom: shadowEl.inShadowDom,
				shadowRootPath: shadowEl.shadowRootPath,
			});
		}

		return merged;
	}

	private async collectInteractiveElementsViaDom(): Promise<any[]> {
		return this.page.$$eval(
			'a, button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"]',
			(elements) => {
				function deriveRole(el: Element): string | undefined {
					// NOSONAR — browser-context helper, cannot be in outer scope
					const explicitRole = el.getAttribute("role");
					if (explicitRole) return explicitRole;
					const tag = el.tagName.toLowerCase();
					if (tag === "a") return "link";
					if (tag === "button") return "button";
					if (tag === "input") return "textbox";
					if (tag === "select") return "combobox";
					if (tag === "textarea") return "textbox";
					return undefined;
				}

				function buildSelector(el: Element): string {
					// NOSONAR — browser-context helper, cannot be in outer scope
					if (el.id) return `#${CSS.escape(el.id)}`;
					const tag = el.tagName.toLowerCase();
					const name = el.getAttribute("name");
					if (name) return `${tag}[name="${name}"]`;
					const ariaLabel = el.getAttribute("aria-label");
					if (ariaLabel) return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
					const placeholder = el.getAttribute("placeholder");
					if (placeholder) return `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
					const type = el.getAttribute("type");
					if (type) return `${tag}[type="${type}"]`;
					const parent = el.parentElement;
					if (parent) {
						const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
						if (siblings.length === 1) return tag;
						return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
					}
					return tag;
				}

				return elements
					.filter((el) => {
						if (el.id?.startsWith("__talox")) return false;
						if (el.getAttribute("aria-hidden") === "true") return false;
						if (el.getAttribute("role") === "presentation") return false;
						return true;
					})
					.map((el, i) => {
						const rect = el.getBoundingClientRect();
						const role = deriveRole(el);
						const label =
							(el as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
							el.getAttribute("aria-label")?.trim() ||
							el.getAttribute("placeholder")?.trim() ||
							el.textContent?.trim().slice(0, 120) ||
							"";
						const selector = buildSelector(el);
						return {
							id: selector || `dom-${i}`,
							tagName: el.tagName.toLowerCase(),
							role,
							text: label,
							boundingBox: {
								x: rect.x,
								y: rect.y,
								width: rect.width,
								height: rect.height,
							},
							isActionable: !(el as HTMLInputElement).disabled,
						};
					});
			},
		);
	}

	/**
	 * Additional pass AFTER the standard DOM walk — detects interactive elements
	 * that are not captured by the AX tree or standard selectors:
	 * - Elements with `cursor: pointer` computed style
	 * - Elements with `onclick` attribute
	 * - Elements with `tabindex` that aren't semantic interactive elements
	 * - Hidden radio/checkbox inputs inside cursor-interactive wrappers
	 */
	private async collectCursorDetectedElements(
		existingIds: Set<string>,
		startIndex: number,
	): Promise<
		Array<{
			id: string;
			tagName: string;
			role?: string;
			text?: string;
			boundingBox: { x: number; y: number; width: number; height: number };
			isActionable: boolean;
			cursorDetected: true;
			detectionMethod: CursorDetectionMethod;
		}>
	> {
		const rawResults = await this.detectCursorElements(Array.from(existingIds));
		return this.mapCursorResults(rawResults, startIndex);
	}

	/**
	 * Run all cursor-detection passes inside the browser in a single evaluate call and return raw results.
	 */
	private async detectCursorElements(existingIds: string[]): Promise<
		Array<{
			selector: string;
			tagName: string;
			text: string;
			boundingBox: { x: number; y: number; width: number; height: number };
			detectionMethod: "cursor-style" | "onclick-attr" | "tabindex";
		}>
	> {
		return this.page.evaluate((existingIds) => {
			const SEMANTIC_TAGS = new Set(["a", "button", "input", "select", "textarea", "details", "summary"]);
			const results: Array<{
				selector: string;
				tagName: string;
				text: string;
				boundingBox: { x: number; y: number; width: number; height: number };
				detectionMethod: "cursor-style" | "onclick-attr" | "tabindex";
			}> = [];
			const seen = [...existingIds];

			function buildSelector(el: Element, tag: string): string {
				if (el.id) return `#${CSS.escape(el.id)}`;
				const name = el.getAttribute("name");
				if (name) return `${tag}[name="${name}"]`;
				const cls = el.getAttribute("class");
				if (cls) {
					const first = cls.trim().split(/\s+/)[0];
					if (first) return `${tag}.${CSS.escape(first)}`;
				}
				const parent = el.parentElement;
				if (parent) {
					const sibs = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
					if (sibs.length === 1) return tag;
					return `${tag}:nth-of-type(${sibs.indexOf(el) + 1})`;
				}
				return tag;
			}

			function isElementHidden(el: Element): boolean {
				if ((el as HTMLElement).style.display === "none") return true;
				if ((el as HTMLElement).style.visibility === "hidden") return true;
				if (el.getAttribute("aria-hidden") === "true") return true;
				return false;
			}

			function isCursorPointerElement(el: Element, tag: string): boolean {
				if (el.id?.startsWith("__talox")) return false;
				if (getComputedStyle(el).cursor !== "pointer") return false;
				if (SEMANTIC_TAGS.has(tag) || el.getAttribute("role")) return false;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return false;
				if (isElementHidden(el)) return false;
				return true;
			}

			function checkCursorPointer() {
				for (const el of Array.from(document.querySelectorAll("*"))) {
					const tag = el.tagName.toLowerCase();
					if (isCursorPointerElement(el, tag)) {
						const sel = buildSelector(el, tag);
						if (!seen.includes(sel)) {
							seen.push(sel);
							const rect = el.getBoundingClientRect();
							results.push({
								selector: sel,
								tagName: tag,
								text: el.textContent?.trim().slice(0, 100) || "",
								boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
								detectionMethod: "cursor-style",
							});
						}
					}
				}
			}

			function isOnclickElement(el: Element, tag: string): boolean {
				if (el.id?.startsWith("__talox")) return false;
				if (SEMANTIC_TAGS.has(tag)) return false;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return false;
				return true;
			}

			function checkOnclick() {
				for (const el of Array.from(document.querySelectorAll("[onclick]"))) {
					const tag = el.tagName.toLowerCase();
					if (isOnclickElement(el, tag)) {
						const sel = buildSelector(el, tag);
						if (!seen.includes(sel)) {
							seen.push(sel);
							const rect = el.getBoundingClientRect();
							results.push({
								selector: sel,
								tagName: tag,
								text: el.textContent?.trim().slice(0, 100) || "",
								boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
								detectionMethod: "onclick-attr",
							});
						}
					}
				}
			}

			function isTabindexElement(el: Element, tag: string): boolean {
				if (el.id?.startsWith("__talox")) return false;
				if (SEMANTIC_TAGS.has(tag) || el.getAttribute("role")) return false;
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return false;
				return true;
			}

			function checkTabindex() {
				for (const el of Array.from(document.querySelectorAll('[tabindex]:not([tabindex="-1"])'))) {
					const tag = el.tagName.toLowerCase();
					if (isTabindexElement(el, tag)) {
						const sel = buildSelector(el, tag);
						if (!seen.includes(sel)) {
							seen.push(sel);
							const rect = el.getBoundingClientRect();
							results.push({
								selector: sel,
								tagName: tag,
								text: el.textContent?.trim().slice(0, 100) || "",
								boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
								detectionMethod: "tabindex",
							});
						}
					}
				}
			}

			function isHiddenInputWrapper(input: HTMLInputElement): Element | null {
				const isHidden =
					input.style.display === "none" ||
					input.style.visibility === "hidden" ||
					input.getAttribute("type") === "hidden";
				if (!isHidden) return null;

				const parent = input.parentElement;
				if (!parent || getComputedStyle(parent).cursor !== "pointer") return null;

				const rect = parent.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return null;

				return parent;
			}

			function checkHiddenInputs() {
				for (const input of Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'))) {
					const parent = isHiddenInputWrapper(input as HTMLInputElement);
					if (parent) {
						const tag = parent.tagName.toLowerCase();
						const sel = buildSelector(parent, tag);
						if (!seen.includes(sel)) {
							seen.push(sel);
							const rect = parent.getBoundingClientRect();
							results.push({
								selector: sel,
								tagName: tag,
								text: parent.textContent?.trim().slice(0, 100) || "",
								boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
								detectionMethod: "cursor-style",
							});
						}
					}
				}
			}

			checkCursorPointer();
			checkOnclick();
			checkTabindex();
			checkHiddenInputs();

			return results;
		}, existingIds);
	}

	/** Map raw detection results to the final output format. */
	private mapCursorResults(
		rawResults: Array<{
			selector: string;
			tagName: string;
			text: string;
			boundingBox: { x: number; y: number; width: number; height: number };
			detectionMethod: "cursor-style" | "onclick-attr" | "tabindex";
		}>,
		startIndex: number,
	): Array<{
		id: string;
		tagName: string;
		role?: string;
		text?: string;
		boundingBox: { x: number; y: number; width: number; height: number };
		isActionable: boolean;
		cursorDetected: true;
		detectionMethod: CursorDetectionMethod;
	}> {
		return rawResults.map((r, i) => ({
			id: r.selector || `cursor-${startIndex + i}`,
			tagName: r.tagName,
			text: r.text,
			boundingBox: r.boundingBox,
			isActionable: true,
			cursorDetected: true as const,
			detectionMethod: r.detectionMethod,
			ref: `cursor-${startIndex + i}`,
		}));
	}

	private parseAriaDescriptor(rawDescriptor: string): {
		role: string;
		name: string;
		boundingBox?: { x: number; y: number; width: number; height: number };
		attributes: Record<string, string | boolean>;
	} | null {
		let descriptor = rawDescriptor.trim();
		if (!descriptor || descriptor === "text" || descriptor.startsWith("/")) return null;

		const attributes: Record<string, string | boolean> = {};
		let boundingBox: { x: number; y: number; width: number; height: number } | undefined;
		const attributePattern = /\s+\[([A-Za-z][\w-]*)(?:=([^\]]+))?\]$/;

		while (true) {
			const match = attributePattern.exec(descriptor);
			if (!match || match.index === undefined) break;
			const key = match[1];
			const rawValue = match[2];

			if (key === "box" && rawValue !== undefined) {
				const values = rawValue.split(",").map((value) => Number(value.trim()));
				if (values.length === 4 && values.every(Number.isFinite)) {
					boundingBox = { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! };
				}
			} else if (key) {
				attributes[key] = rawValue === undefined ? true : rawValue;
			}

			descriptor = descriptor.slice(0, match.index).trim();
		}

		const separator = descriptor.indexOf(" ");
		const role = separator === -1 ? descriptor : descriptor.slice(0, separator);
		const rawName = separator === -1 ? "" : descriptor.slice(separator + 1).trim();
		if (!role || role.startsWith("/")) return null;

		let name = "";
		if (rawName) {
			if (rawName.startsWith('"') && rawName.endsWith('"')) {
				try {
					name = JSON.parse(rawName) as string;
				} catch {
					name = rawName.slice(1, -1);
				}
			} else {
				name = rawName;
			}
		}

		return { role, name, ...(boundingBox && { boundingBox }), attributes };
	}

	private collectAriaDirectiveAttributes(value: unknown): Record<string, string | boolean> {
		const attributes: Record<string, string | boolean> = {};
		if (!Array.isArray(value)) return attributes;

		for (const entry of value) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
			for (const [key, directiveValue] of Object.entries(entry as Record<string, unknown>)) {
				if (!key.startsWith("/") || directiveValue === null || directiveValue === undefined) continue;
				if (typeof directiveValue === "boolean") attributes[key.slice(1)] = directiveValue;
				else if (typeof directiveValue === "string" || typeof directiveValue === "number") {
					attributes[key.slice(1)] = String(directiveValue);
				}
			}
		}
		return attributes;
	}

	private flattenAriaYaml(value: unknown, result: TaloxNode[] = []): TaloxNode[] {
		if (Array.isArray(value)) {
			for (const entry of value) this.flattenAriaYaml(entry, result);
			return result;
		}

		if (typeof value === "string") {
			const descriptor = this.parseAriaDescriptor(value);
			if (descriptor?.boundingBox) {
				result.push({
					id: `aria-${result.length}`,
					role: descriptor.role,
					name: descriptor.name,
					description: "",
					boundingBox: descriptor.boundingBox,
					...(Object.keys(descriptor.attributes).length > 0 && { attributes: descriptor.attributes }),
					trust: "first-party",
				});
			}
			return result;
		}

		if (!value || typeof value !== "object") return result;

		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			const descriptor = this.parseAriaDescriptor(key);
			if (descriptor?.boundingBox) {
				const attributes = {
					...descriptor.attributes,
					...this.collectAriaDirectiveAttributes(child),
				};
				if (typeof child === "string" && child.trim()) attributes.text = child.trim();

				result.push({
					id: `aria-${result.length}`,
					role: descriptor.role,
					name: descriptor.name,
					description: "",
					boundingBox: descriptor.boundingBox,
					...(Object.keys(attributes).length > 0 && { attributes }),
					trust: "first-party",
				});
			}

			this.flattenAriaYaml(child, result);
		}
		return result;
	}

	private flattenModernAriaSnapshot(snapshot: string): TaloxNode[] {
		try {
			return this.flattenAriaYaml(loadYaml(snapshot));
		} catch (error) {
			throw new Error(`Failed to parse Playwright ARIA snapshot: ${(error as Error).message}`);
		}
	}

	private flattenAXTree(node: any, result: TaloxNode[] = []) {
		// If it has a role, it's a candidate
		if (node.role) {
			const box = node.box || node.boundingBox;
			if (box) {
				const newNode: TaloxNode = {
					id: `ax-${result.length}`,
					role: node.role,
					name: node.name || "",
					description: node.description || "",
					boundingBox: {
						x: box.x,
						y: box.y,
						width: box.width,
						height: box.height,
					},
					trust: "first-party",
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

	private async collectWithRetry(
		nodeThreshold: number,
		maxRetriesOverride?: number,
	): Promise<{ nodes: TaloxNode[]; shouldUseFallback: boolean }> {
		const configuredMaxRetries = this.options.retry.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;
		const maxRetries = maxRetriesOverride ?? configuredMaxRetries;
		let nodes: TaloxNode[] = [];
		let axSnapshot: unknown = null;
		let axTreeError: Error | null = null;

		const modernSnapshot = (this.page as unknown as {
			ariaSnapshot?: (options?: { mode?: "ai" | "default"; boxes?: boolean }) => Promise<string>;
		}).ariaSnapshot;
		const accessibility = (this.page as any).accessibility;
		const legacySnapshot = accessibility?.snapshot;

		if (typeof modernSnapshot !== "function" && typeof legacySnapshot !== "function") {
			return { nodes: [], shouldUseFallback: this.options.useDomFallback };
		}

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			this.retryStats.axTreeAttempts++;

			try {
				if (attempt > 0) {
					const delay = this.calculateBackoff(attempt - 1);
					this.retryStats.totalDelayMs += delay;
					await this.sleep(delay);
				}

				try {
					if (typeof modernSnapshot === "function") {
						axSnapshot = await modernSnapshot.call(this.page, { mode: "default", boxes: true });
						nodes = typeof axSnapshot === "string" ? this.flattenModernAriaSnapshot(axSnapshot) : [];
					} else {
						axSnapshot = await legacySnapshot.call(accessibility);
						nodes = axSnapshot ? this.flattenAXTree(axSnapshot) : [];
					}
				} catch (error_) {
					axTreeError = error_ as Error;
					axSnapshot = null;
				}

				if (axSnapshot) {
					this.retryStats.axTreeSuccesses++;
					break;
				}

				axTreeError = new Error("Accessibility snapshot returned empty output");
			} catch (err) {
				axTreeError = err as Error;
				this.retryStats.lastError = axTreeError.message;
			}
		}

		const shouldUseFallback =
			this.options.useDomFallback && (nodes.length < nodeThreshold || axTreeError !== null || axSnapshot === null);

		return { nodes, shouldUseFallback };
	}

	async collect(): Promise<TaloxPageState> {
		// Guard against calling collect() on a page that has already been closed
		// (e.g. during browser teardown or headed/headless restart races).
		const closed = (this.page as unknown as { isClosed?: () => boolean }).isClosed?.();
		if (closed) {
			const fallbackTs = new Date().toISOString();
			return {
				url: "about:blank",
				title: "",
				timestamp: fallbackTs,
				console: { errors: [] },
				network: { failedRequests: [] },
				nodes: [],
				interactiveElements: [],
				bugs: [],
				timing: { totalMs: 0, collectedAt: fallbackTs },
			};
		}

		const collectStart = Date.now();
		const url = this.page.url();
		const title = await this.page.title();
		// Browser-synthetic documents do not have an application hydration lifecycle.
		// Retrying an empty AX tree here only adds deterministic backoff delay. Keep
		// one complete collection pass so dynamically inserted DOM is still observed.
		const syntheticDocument = url === "about:blank" || url === "about:srcdoc";

		this.retryStats.attempts++;

		let nodes: TaloxNode[] = [];
		let shouldUseFallback = false;
		const nodeThreshold = this.options.domFallbackThreshold;

		let collectionAttempts = 0;
		const maxCollectionAttempts = syntheticDocument ? 1 : 3;

		while (collectionAttempts < maxCollectionAttempts) {
			const result = await this.collectWithRetry(nodeThreshold, syntheticDocument ? 0 : undefined);
			nodes = result.nodes;
			shouldUseFallback = result.shouldUseFallback;

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

		let interactiveElements: Array<{ id: string; tagName: string; boundingBox: any }> = [];
		let shadowDomElements: TaloxNode[] = [];
		try {
			interactiveElements = shouldUseFallback
				? nodes.map((n, i) => ({
						id: n.id || `dom-${i}`,
						tagName: (n.attributes?.tag as string) || "unknown",
						role: n.role || undefined,
						text: n.name || n.description || "",
						boundingBox: n.boundingBox,
						isActionable: n.attributes?.disabled !== "true",
						trust: n.trust || "first-party",
					}))
				: await this.collectInteractiveElementsViaDom();

			shadowDomElements = await this.collectFromShadowDom();
		} catch {
			// Page may have closed mid-collection; return what we have
		}
		const mergedInteractiveElements = this.mergeInteractiveElements(interactiveElements, shadowDomElements);

		// Additional pass: cursor-detected elements (cursor:pointer, onclick, tabindex, hidden inputs)
		const existingIds = new Set(mergedInteractiveElements.map((el: any) => el.id));
		const cursorStartIndex = mergedInteractiveElements.length;
		let cursorDetectedElements: any[] = [];
		try {
			cursorDetectedElements = await this.collectCursorDetectedElements(existingIds, cursorStartIndex);
		} catch {
			// Page may have closed mid-collection; return what we have
		}

		const allInteractiveElements = [...mergedInteractiveElements, ...cursorDetectedElements];
		// Default trust for elements that don't have it (cursor-detected, legacy paths)
		for (const el of allInteractiveElements) {
			if (!el.trust) el.trust = "first-party";
		}

		const collectedAt = new Date().toISOString();
		const state: TaloxPageState = {
			url,
			title,
			timestamp: collectedAt,
			console: { errors: [...this.consoleErrors] },
			network: { failedRequests: [...this.failedRequests] },
			nodes,
			interactiveElements: allInteractiveElements,
			bugs: [],
			timing: {
				totalMs: Date.now() - collectStart,
				collectedAt,
			},
		};
		this.lastState = state;
		return state;
	}

	/** Returns nodes from the most recent collect() call. */
	getLastNodes(): TaloxNode[] {
		return this.lastState?.nodes ?? [];
	}
}
