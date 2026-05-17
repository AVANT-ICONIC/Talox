import type { Page } from "playwright-core";
/**
 * @file SiteWarmup.ts
 * @description Generic site warmup registry for bypassing bot-detection
 * interstitials (Cloudflare challenges, CAPTCHA pre-screens, etc.).
 *
 * Each warmup strategy has a `detect` function (checks if the interstitial is
 * present) and a `warmup` function (performs the bypass). Strategies are
 * registered per hostname suffix. The {@link SiteWarmupRegistry} provides
 * built-in strategies for known sites and allows callers to register custom
 * ones.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A warmup strategy for a specific site or challenge type.
 *
 * @example
 * ```ts
 * const myStrategy: WarmupStrategy = {
 *   name: "acme-challenge",
 *   detect: async (page) => {
 *     const title = await page.title();
 *     return title.includes("Verify");
 *   },
 *   warmup: async (page, url) => {
 *     await page.goto(url, { waitUntil: "domcontentloaded" });
 *   },
 * };
 * ```
 */
export interface WarmupStrategy {
	/** Human-readable name for logging and debugging. */
	name: string;
	/**
	 * Detect whether the interstitial is present on the current page.
	 * @param page - The Playwright Page object.
	 * @returns `true` if the warmup should be triggered.
	 */
	detect: (page: Page) => Promise<boolean> | boolean;
	/**
	 * Perform the warmup to bypass the interstitial.
	 * @param page - The Playwright Page object.
	 * @param url  - The URL to re-navigate to if needed.
	 */
	warmup: (page: Page, url: string) => Promise<void>;
}

// ─── Built-in Strategies ──────────────────────────────────────────────────────

/**
 * Reddit: bypasses the "Prove your humanity" reCAPTCHA interstitial that
 * appears on first navigation. The `edgebucket` cookie is set during the
 * initial request, so simply navigating again with `domcontentloaded` bypasses
 * the challenge.
 */
export const redditWarmup: WarmupStrategy = {
	name: "reddit-humanity-challenge",
	detect: async (page: Page): Promise<boolean> => {
		const title = await page.title();
		return title.includes("Prove") || title.includes("humanity");
	},
	warmup: async (page: Page, url: string): Promise<void> => {
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
		await new Promise((r) => setTimeout(r, 1000));
	},
};

/**
 * Generic Cloudflare: handles the "Checking your browser" / "Just a moment"
 * interstitial. Waits for the challenge to resolve, then re-navigates.
 */
export const cloudflareWarmup: WarmupStrategy = {
	name: "cloudflare-challenge",
	detect: async (page: Page): Promise<boolean> => {
		const title = await page.title();
		if (title.includes("Checking") || title.includes("Just a moment")) {
			return true;
		}
		// Also check body for cf-browser-verification
		try {
			const hasCfBody = await page.evaluate(() => {
				const html = document.body?.innerHTML ?? "";
				return html.includes("cf-browser-verification") || html.includes("challenge-platform");
			});
			return hasCfBody as boolean;
		} catch {
			return false;
		}
	},
	warmup: async (page: Page, url: string): Promise<void> => {
		await new Promise((r) => setTimeout(r, 5000));
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
		await new Promise((r) => setTimeout(r, 1000));
	},
};

/**
 * Generic verification page: handles pages with titles containing "Verify"
 * or "Attention Required" that are not Cloudflare-specific.
 */
export const genericVerificationWarmup: WarmupStrategy = {
	name: "generic-verification",
	detect: async (page: Page): Promise<boolean> => {
		const title = await page.title();
		return title.includes("Attention Required") || title.includes("Access denied") || title.includes("Forbidden");
	},
	warmup: async (page: Page, url: string): Promise<void> => {
		await new Promise((r) => setTimeout(r, 3000));
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
		await new Promise((r) => setTimeout(r, 1000));
	},
};

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * A map of hostname suffix → warmup strategy. Hostname suffixes are matched
 * from the end (e.g., `"reddit.com"` matches `"www.reddit.com"`).
 */
export type WarmupMap = Map<string, WarmupStrategy>;

/**
 * Pre-registered built-in warmups for known sites.
 */
export const BUILT_IN_WARMUPS: WarmupMap = new Map([
	["reddit.com", redditWarmup],
	["cloudflare.com", cloudflareWarmup],
	// The cloudflare warmup is also the default for any site that triggers it.
	// It is registered as a fallback via the '*' key.
	["*", cloudflareWarmup],
]);

/**
 * Registry that maps hostname suffixes to {@link WarmupStrategy} instances.
 * Supports wildcard (`*`) as a fallback when no specific match is found.
 */
export class SiteWarmupRegistry {
	private readonly warmups: WarmupMap;

	constructor(builtins: WarmupMap = BUILT_IN_WARMUPS) {
		this.warmups = new Map(builtins);
	}

	/**
	 * Register a warmup strategy for a hostname suffix.
	 *
	 * @param hostname - Hostname suffix to match (e.g., `"reddit.com"`).
	 *                   Use `"*"` to register a catch-all fallback.
	 * @param strategy - The warmup strategy.
	 */
	register(hostname: string, strategy: WarmupStrategy): void {
		this.warmups.set(hostname, strategy);
	}

	/**
	 * Look up the warmup strategy for a URL's hostname.
	 *
	 * Resolution order:
	 * 1. Exact hostname match.
	 * 2. Parent domain match (strips subdomains one level at a time).
	 * 3. Wildcard `"*"` fallback.
	 * 4. `undefined` if nothing matches.
	 *
	 * @param hostname - The hostname from the page URL.
	 * @returns The matching warmup strategy, or `undefined`.
	 */
	getWarmup(hostname: string): WarmupStrategy | undefined {
		// 1. Exact match
		if (this.warmups.has(hostname)) {
			return this.warmups.get(hostname);
		}

		// 2. Walk up the domain (strip subdomains)
		let domain = hostname;
		while (domain.includes(".")) {
			const idx = domain.indexOf(".");
			domain = domain.slice(idx + 1);
			if (this.warmups.has(domain)) {
				return this.warmups.get(domain);
			}
		}

		// 3. Wildcard fallback
		return this.warmups.get("*");
	}

	/**
	 * Check whether a warmup strategy exists for the given hostname.
	 */
	has(hostname: string): boolean {
		return this.getWarmup(hostname) !== undefined;
	}

	/**
	 * Remove a registered warmup strategy.
	 */
	unregister(hostname: string): boolean {
		return this.warmups.delete(hostname);
	}

	/**
	 * List all registered hostname suffixes.
	 */
	keys(): string[] {
		return Array.from(this.warmups.keys());
	}

	/**
	 * Run the warmup for the given hostname if a strategy is registered
	 * and its `detect` function returns `true`.
	 *
	 * @param page     - The Playwright Page object.
	 * @param url      - The current page URL.
	 * @param hostname - The hostname extracted from the URL.
	 * @returns `true` if a warmup was performed, `false` otherwise.
	 */
	async runIfNeeded(page: Page, url: string, hostname: string): Promise<boolean> {
		const strategy = this.getWarmup(hostname);
		if (!strategy) return false;

		try {
			const detected = await strategy.detect(page);
			if (!detected) return false;

			await strategy.warmup(page, url);
			return true;
		} catch {
			// Warmup failures are non-fatal — the agent proceeds regardless.
			return false;
		}
	}
}
