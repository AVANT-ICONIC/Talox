/**
 * @file OriginHeaders.ts
 * @description Per-origin HTTP header injection via Playwright request interception.
 *
 * Allows agents to attach authorization tokens, API keys, or custom headers
 * to requests targeting specific origins — without modifying global browser state.
 */

import type { Page, Route } from "playwright-core";

export interface OriginHeaderConfig {
	[origin: string]: Record<string, string>;
}

/**
 * Manages per-origin HTTP headers and installs request interception on a Playwright page.
 *
 * @example
 * ```ts
 * const headers = new OriginHeaders({
 *   'https://api.example.com': { 'Authorization': 'Bearer token123' },
 * });
 * headers.install(page);
 * // All requests to https://api.example.com now include the Authorization header.
 * ```
 */
export class OriginHeaders {
	private readonly config: Map<string, Record<string, string>> = new Map();
	private installedPage: Page | null = null;
	private routeHandler: ((route: Route) => Promise<void>) | null = null;

	constructor(config?: OriginHeaderConfig) {
		if (config) {
			for (const [origin, headers] of Object.entries(config)) {
				this.config.set(origin, { ...headers });
			}
		}
	}

	setHeaders(origin: string, headers: Record<string, string>): void {
		this.config.set(origin, { ...headers });
	}

	removeHeaders(origin: string): void {
		this.config.delete(origin);
	}

	getHeadersForUrl(url: string): Record<string, string> {
		const origins = Array.from(this.config.keys());
		for (const origin of origins) {
			if (url.startsWith(origin)) {
				return { ...this.config.get(origin)! };
			}
		}
		return {};
	}

	install(page: Page): void {
		this.installedPage = page;
		this.routeHandler = this.createRouteHandler();

		void page.route("**/*", this.routeHandler);
	}

	private createRouteHandler(): (route: Route) => Promise<void> {
		return async (route: Route) => {
			const request = route.request();
			const url = request.url();
			const extraHeaders = this.getHeadersForUrl(url);

			if (Object.keys(extraHeaders).length === 0) {
				await route.continue();
				return;
			}

			const existingHeaders = request.headers();
			const mergedHeaders: Record<string, string> = {
				...existingHeaders,
				...extraHeaders,
			};

			await route.continue({ headers: mergedHeaders });
		};
	}

	async dispose(): Promise<void> {
		if (this.installedPage && this.routeHandler) {
			try {
				await this.installedPage.unroute("**/*", this.routeHandler);
			} catch { // NOSONAR -- non-fatal
				// NOSONAR — page may already be closed
			}
			this.installedPage = null;
			this.routeHandler = null;
		}
		this.config.clear();
	}
}
