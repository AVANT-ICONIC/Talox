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

type RouteHandler = (route: Route) => Promise<void>;

interface SessionRouteRegistration {
	handler: RouteHandler;
	onClose: () => void;
}

/**
 * Manages per-origin HTTP headers and installs request interception on a Playwright page.
 *
 * @example
 * ```ts
 * const headers = new OriginHeaders({
 *   'https://api.example.com': { 'Authorization': 'Bearer token123' },
 * });
 * await headers.install(page);
 * // All requests to https://api.example.com now include the Authorization header.
 * ```
 */
export class OriginHeaders {
	private readonly config: Map<string, Record<string, string>> = new Map();
	private installedPage: Page | null = null;
	private routeHandler: RouteHandler | null = null;
	private rollbackRoutes: Array<{ page: Page; handler: RouteHandler }> = [];
	private readonly sessionRoutes = new Map<Page, SessionRouteRegistration>();

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
		let requestUrl: URL;
		try {
			requestUrl = new URL(url);
		} catch {
			return {};
		}

		for (const [configuredTarget, headers] of this.config) {
			if (this.matchesTarget(requestUrl, configuredTarget)) {
				return { ...headers };
			}
		}
		return {};
	}

	async install(page: Page): Promise<void> {
		if (this.installedPage === page && this.routeHandler) return;

		const nextHandler = this.createRouteHandler();
		const routePromise = page.route("**/*", nextHandler);
		if (routePromise) await routePromise;

		const previousPage = this.installedPage;
		const previousHandler = this.routeHandler;
		if (previousPage && previousHandler) {
			try {
				await previousPage.unroute("**/*", previousHandler);
			} catch (error) {
				try {
					await page.unroute("**/*", nextHandler);
				} catch {
					// Preserve ownership so dispose() can retry removing the rollback route.
					this.rollbackRoutes.push({ page, handler: nextHandler });
				}
				throw error;
			}
		}

		this.installedPage = page;
		this.routeHandler = nextHandler;
	}

	/**
	 * Install a route owned by the current Talox session without replacing routes
	 * already installed on sibling pages. Repeated installs on the same page are
	 * idempotent and failed registrations never claim ownership.
	 */
	async installSessionPage(page: Page): Promise<void> {
		if (this.sessionRoutes.has(page)) return;

		const handler = this.createRouteHandler();
		const onClose = () => {
			this.sessionRoutes.delete(page);
		};
		page.once("close", onClose);

		try {
			const routePromise = page.route("**/*", handler);
			if (routePromise) await routePromise;
		} catch (error) {
			page.off("close", onClose);
			throw error;
		}

		this.sessionRoutes.set(page, { handler, onClose });

		// The page can close while route registration is awaiting Playwright.
		// A close event that fires before ownership is recorded deletes nothing,
		// so reconcile against the authoritative page state before returning.
		if (page.isClosed()) {
			page.off("close", onClose);
			this.sessionRoutes.delete(page);
		}
	}

	private createRouteHandler(): RouteHandler {
		return async (route: Route) => {
			const request = route.request();
			const url = request.url();
			const extraHeaders = this.getHeadersForUrl(url);

			if (Object.keys(extraHeaders).length === 0) {
				await route.fallback();
				return;
			}

			const existingHeaders = request.headers();
			const mergedHeaders: Record<string, string> = {
				...existingHeaders,
				...extraHeaders,
			};

			// Use fallback rather than continue so earlier security/policy routes can
			// inspect the final injected headers before the request reaches the network.
			await route.fallback({ headers: mergedHeaders });
		};
	}

	private matchesTarget(requestUrl: URL, configuredTarget: string): boolean {
		let targetUrl: URL;
		try {
			targetUrl = new URL(configuredTarget);
		} catch {
			return false;
		}

		if (requestUrl.origin !== targetUrl.origin) return false;

		const targetPath = targetUrl.pathname;
		if (targetPath === "/" || targetPath === "") return true;
		if (requestUrl.pathname === targetPath) return true;

		const pathPrefix = targetPath.endsWith("/") ? targetPath : `${targetPath}/`;
		return requestUrl.pathname.startsWith(pathPrefix);
	}

	async dispose(): Promise<void> {
		if (this.installedPage && this.routeHandler) {
			try {
				await this.installedPage.unroute("**/*", this.routeHandler);
			} catch {
				// NOSONAR — page may already be closed
			}
			this.installedPage = null;
			this.routeHandler = null;
		}

		const rollbackRoutes = this.rollbackRoutes;
		this.rollbackRoutes = [];
		for (const { page, handler } of rollbackRoutes) {
			try {
				await page.unroute("**/*", handler);
			} catch {
				// NOSONAR — page may already be closed
			}
		}

		const sessionRoutes = [...this.sessionRoutes];
		this.sessionRoutes.clear();
		for (const [page, { handler, onClose }] of sessionRoutes) {
			page.off("close", onClose);
			try {
				await page.unroute("**/*", handler);
			} catch {
				// NOSONAR — page may already be closed
			}
		}

		this.config.clear();
	}
}
