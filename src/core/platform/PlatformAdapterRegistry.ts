const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

export type PlatformAdapterKind = "site" | "cms" | "commerce" | "collaboration";

export interface PlatformAdapterContext {
	url: string;
	hostname: string;
	pathname: string;
	search: Readonly<Record<string, string>>;
	title?: string;
}

export interface PlatformRouteHint {
	pattern: string;
	purpose: string;
}

/**
 * A platform adapter contributes stable semantic guidance for a known web UI.
 * It does not execute browser actions and must not bypass Talox policy gates.
 */
export interface PlatformAdapter {
	id: string;
	name: string;
	kind: PlatformAdapterKind;
	priority?: number;
	match(context: Readonly<PlatformAdapterContext>): number;
	guidance: readonly string[];
	routes?: readonly PlatformRouteHint[];
}

export interface PlatformAdapterMatch {
	adapterId: string;
	name: string;
	kind: PlatformAdapterKind;
	confidence: number;
	guidance: readonly string[];
	routes: readonly PlatformRouteHint[];
}

function parseContext(url: string, title?: string): PlatformAdapterContext | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
		const search: Record<string, string> = {};
		for (const [key, value] of parsed.searchParams) search[key] = value;
		const context: PlatformAdapterContext = {
			url: parsed.toString(),
			hostname: parsed.hostname.toLowerCase(),
			pathname: parsed.pathname,
			search,
		};
		if (title) context.title = title;
		return context;
	} catch {
		return null;
	}
}

function hostIs(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

function normalizeAdapter(adapter: PlatformAdapter): PlatformAdapter {
	if (!adapter || typeof adapter !== "object") throw new TypeError("adapter must be an object.");
	if (typeof adapter.id !== "string" || !ADAPTER_ID_PATTERN.test(adapter.id)) {
		throw new TypeError("adapter.id must be a lowercase identifier using letters, numbers, '.', '_', '/', or '-'.");
	}
	if (typeof adapter.name !== "string" || adapter.name.trim().length === 0) {
		throw new TypeError("adapter.name must be a non-empty string.");
	}
	if (!["site", "cms", "commerce", "collaboration"].includes(adapter.kind)) {
		throw new TypeError("adapter.kind is invalid.");
	}
	if (typeof adapter.match !== "function") throw new TypeError("adapter.match must be a function.");
	if (!Array.isArray(adapter.guidance) || !adapter.guidance.every((item) => typeof item === "string" && item.trim())) {
		throw new TypeError("adapter.guidance must contain non-empty strings.");
	}
	if (
		adapter.routes !== undefined &&
		(!Array.isArray(adapter.routes) ||
			!adapter.routes.every(
				(route) =>
					route &&
					typeof route === "object" &&
					typeof route.pattern === "string" &&
					route.pattern.length > 0 &&
					typeof route.purpose === "string" &&
					route.purpose.length > 0,
			))
	) {
		throw new TypeError("adapter.routes must contain valid route hints.");
	}
	return {
		...adapter,
		name: adapter.name.trim(),
		guidance: [...adapter.guidance],
		routes: adapter.routes ? [...adapter.routes] : undefined,
	};
}

export const wordpressAdminAdapter: PlatformAdapter = {
	id: "wordpress-admin",
	name: "WordPress Admin",
	kind: "cms",
	priority: 50,
	match: ({ pathname }) => {
		if (pathname === "/wp-login.php") return 0.86;
		if (pathname === "/wp-admin" || pathname.startsWith("/wp-admin/")) return 0.94;
		return 0;
	},
	guidance: [
		"Prefer accessible role/name targets and visible admin labels over generated CSS classes.",
		"WordPress admin list screens commonly expose row actions only after focusing or hovering a row; re-observe before choosing an action.",
		"After edits, verify the visible success notice and page state instead of assuming Publish, Update, or Save Changes succeeded.",
		"Treat plugin-provided admin pages as variable UI; use the live Talox state when it conflicts with these hints.",
	],
	routes: [
		{ pattern: "/wp-admin/edit.php", purpose: "post/page list tables" },
		{ pattern: "/wp-admin/post-new.php", purpose: "create content" },
		{ pattern: "/wp-admin/plugins.php", purpose: "plugin management" },
		{ pattern: "/wp-admin/options-general.php", purpose: "general settings" },
	],
};

export const woocommerceAdminAdapter: PlatformAdapter = {
	id: "woocommerce-admin",
	name: "WooCommerce Admin",
	kind: "commerce",
	priority: 100,
	match: ({ pathname, search }) => {
		if (!(pathname === "/wp-admin" || pathname.startsWith("/wp-admin/"))) return 0;
		const page = search.page ?? "";
		const postType = search.post_type ?? "";
		if (page === "wc-admin" || page.startsWith("wc-") || page.startsWith("woocommerce")) return 1;
		if (["product", "shop_order", "shop_coupon"].includes(postType)) return 0.99;
		return 0;
	},
	guidance: [
		"WooCommerce runs inside WordPress, so WordPress Admin guidance also applies when both adapters match.",
		"Prefer order/product names, statuses, table headers, and button labels from current state instead of brittle numeric row selectors.",
		"For destructive or commercial changes, confirm the target entity and resulting status after the action.",
		"WooCommerce extensions can replace core screens; live semantics always outrank adapter hints.",
	],
	routes: [
		{ pattern: "/wp-admin/admin.php?page=wc-admin", purpose: "WooCommerce dashboard and React-based admin screens" },
		{ pattern: "/wp-admin/edit.php?post_type=product", purpose: "product management" },
		{ pattern: "/wp-admin/edit.php?post_type=shop_order", purpose: "legacy order management" },
	],
};

export const shopifyAdminAdapter: PlatformAdapter = {
	id: "shopify-admin",
	name: "Shopify Admin",
	kind: "commerce",
	priority: 90,
	match: ({ hostname, pathname }) => {
		if (hostname === "admin.shopify.com") return 1;
		if (hostIs(hostname, "myshopify.com") && (pathname === "/admin" || pathname.startsWith("/admin/"))) return 0.97;
		return 0;
	},
	guidance: [
		"Shopify Admin is a client-rendered application; re-observe after navigation, drawers, and modal transitions.",
		"Prefer visible resource names and accessible labels over generated Polaris class names.",
		"Save buttons can become enabled only after state changes; confirm both enabled state and the post-save confirmation.",
		"Treat app-embedded admin pages as third-party UI whose semantics may differ from core Shopify screens.",
	],
	routes: [
		{ pattern: "/store/<store>/products", purpose: "product management" },
		{ pattern: "/store/<store>/orders", purpose: "order management" },
		{ pattern: "/store/<store>/settings", purpose: "store settings" },
	],
};

export const githubAdapter: PlatformAdapter = {
	id: "github",
	name: "GitHub",
	kind: "site",
	priority: 40,
	match: ({ hostname }) => (hostname === "github.com" || hostname === "gist.github.com" ? 0.98 : 0),
	guidance: [
		"Prefer repository, issue, pull-request, tab, and button accessible names over CSS class selectors.",
		"Before write actions, verify the repository owner/name and current branch or pull request in the live state.",
		"GitHub frequently updates partial page regions without a full navigation; re-observe after menus, filters, and mutations.",
	],
	routes: [
		{ pattern: "/<owner>/<repo>/issues", purpose: "issues" },
		{ pattern: "/<owner>/<repo>/pulls", purpose: "pull requests" },
		{ pattern: "/<owner>/<repo>/actions", purpose: "workflow runs" },
	],
};

export const slackAdapter: PlatformAdapter = {
	id: "slack-web",
	name: "Slack Web",
	kind: "collaboration",
	priority: 40,
	match: ({ hostname }) => (hostname === "app.slack.com" ? 0.98 : 0),
	guidance: [
		"Slack is highly dynamic; use current accessible names for channels, conversations, buttons, and dialogs.",
		"Confirm the active workspace and conversation before sending or editing a message.",
		"Virtualized message lists can recycle DOM nodes; re-observe after scrolling instead of retaining old element assumptions.",
	],
	routes: [{ pattern: "/client/<workspace>/<channel>", purpose: "workspace channel or direct-message view" }],
};

export const BUILT_IN_PLATFORM_ADAPTERS: readonly PlatformAdapter[] = Object.freeze([
	woocommerceAdminAdapter,
	shopifyAdminAdapter,
	wordpressAdminAdapter,
	githubAdapter,
	slackAdapter,
]);

/** Registry for deterministic platform detection and planner-context rendering. */
export class PlatformAdapterRegistry {
	private readonly adapters = new Map<string, PlatformAdapter>();

	constructor(adapters: readonly PlatformAdapter[] = BUILT_IN_PLATFORM_ADAPTERS) {
		for (const adapter of adapters) this.register(adapter);
	}

	register(adapter: PlatformAdapter): void {
		const normalized = normalizeAdapter(adapter);
		if (this.adapters.has(normalized.id)) throw new Error(`Platform adapter '${normalized.id}' is already registered.`);
		this.adapters.set(normalized.id, normalized);
	}

	unregister(id: string): boolean {
		return this.adapters.delete(id);
	}

	list(): PlatformAdapter[] {
		return [...this.adapters.values()].map((adapter) => ({
			...adapter,
			guidance: [...adapter.guidance],
			routes: adapter.routes ? [...adapter.routes] : undefined,
		}));
	}

	match(url: string, title?: string): PlatformAdapterMatch[] {
		const context = parseContext(url, title);
		if (!context) return [];
		const matches: Array<PlatformAdapterMatch & { priority: number; order: number }> = [];
		let order = 0;
		for (const adapter of this.adapters.values()) {
			try {
				const confidence = adapter.match(context);
				if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
					order++;
					continue;
				}
				matches.push({
					adapterId: adapter.id,
					name: adapter.name,
					kind: adapter.kind,
					confidence,
					guidance: [...adapter.guidance],
					routes: adapter.routes ? [...adapter.routes] : [],
					priority: adapter.priority ?? 0,
					order,
				});
			} catch {
				// A broken custom adapter must never block planning.
			}
			order++;
		}
		matches.sort((a, b) => b.confidence - a.confidence || b.priority - a.priority || a.order - b.order);
		return matches.map(({ priority: _priority, order: _order, ...match }) => match);
	}

	toContextForUrl(url: string, title?: string): string {
		const matches = this.match(url, title);
		if (matches.length === 0) return "";
		const lines = [
			"# Platform Adapter Context",
			"",
			"These are stable platform hints, not page truth. Prefer the current Talox state whenever it disagrees.",
		];
		for (const match of matches) {
			lines.push("", `## ${match.name} (${Math.round(match.confidence * 100)}% match)`);
			for (const hint of match.guidance) lines.push(`- ${hint}`);
			if (match.routes.length > 0) {
				lines.push("- Known route patterns:");
				for (const route of match.routes) lines.push(`  - ${route.pattern}: ${route.purpose}`);
			}
		}
		return lines.join("\n");
	}
}

/** Shared immutable built-in registry for normal planner-context lookup. */
const defaultRegistry = new PlatformAdapterRegistry();

export function getPlatformAdapterContext(url: string, title?: string): string {
	return defaultRegistry.toContextForUrl(url, title);
}

export function matchPlatformAdapters(url: string, title?: string): PlatformAdapterMatch[] {
	return defaultRegistry.match(url, title);
}
