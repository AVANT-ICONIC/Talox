export {
	BUILT_IN_PLATFORM_ADAPTERS,
	PlatformAdapterRegistry,
	getPlatformAdapterContext,
	githubAdapter,
	matchPlatformAdapters,
	shopifyAdminAdapter,
	slackAdapter,
	woocommerceAdminAdapter,
	wordpressAdminAdapter,
} from "./core/platform/PlatformAdapterRegistry.js";
export type {
	PlatformAdapter,
	PlatformAdapterContext,
	PlatformAdapterKind,
	PlatformAdapterMatch,
	PlatformRouteHint,
} from "./core/platform/PlatformAdapterRegistry.js";
