# Platform Adapters

Platform Adapters give Talox stable, built-in knowledge about common web applications without creating a second browser-automation layer.

Adapters **do not click, type, navigate, or bypass policy**. They only detect a known platform from stable URL/title evidence and contribute concise semantic guidance to the planner. The live Talox page state always wins when a platform changes.

## Built-in adapters

| Adapter | Match examples | Purpose |
| --- | --- | --- |
| WordPress Admin | `/wp-admin/*`, `/wp-login.php` | CMS navigation, list-table, save/update guidance |
| WooCommerce Admin | `wc-admin`, product/order admin routes | Commerce-specific guidance layered over WordPress |
| Shopify Admin | `admin.shopify.com`, `*.myshopify.com/admin/*` | Shopify resource/admin semantics |
| GitHub | `github.com`, `gist.github.com` | Repository, issue, PR, actions semantics |
| Slack Web | `app.slack.com/client/*` | Workspace/conversation and virtualized-message guidance |

WooCommerce intentionally matches together with WordPress Admin. The more specific WooCommerce adapter ranks first, while the WordPress adapter contributes the underlying CMS behavior.

## Automatic planner integration

Single-agent `AutonomousLoop` and multi-agent `PlanDelegateObserveLoop` append matching built-in adapter context to the same planner knowledge block already used for domain skills. This means adapters work without changing the planner schema or controller execution API.

Adapter context is explicitly framed as hints, not page truth. The planner should use the current structured state whenever the live UI disagrees.

## Public API

The adapter API is available from `talox/adapters`:

```ts
import {
  PlatformAdapterRegistry,
  matchPlatformAdapters,
  getPlatformAdapterContext,
} from "talox/adapters";

const matches = matchPlatformAdapters(
  "https://shop.example/wp-admin/edit.php?post_type=product",
);

console.log(matches.map((match) => match.adapterId));
// ["woocommerce-admin", "wordpress-admin"]

console.log(
  getPlatformAdapterContext("https://github.com/AVANT-ICONIC/Talox/pulls"),
);
```

## Custom registries

Applications can create isolated registries without mutating Talox's built-in defaults:

```ts
const registry = new PlatformAdapterRegistry([]);

registry.register({
  id: "acme-console",
  name: "Acme Console",
  kind: "site",
  match: ({ hostname }) => hostname === "console.acme.test" ? 1 : 0,
  guidance: [
    "Prefer accessible labels over generated CSS selectors.",
    "Re-observe after opening drawers because the console updates in place.",
  ],
});
```

`match()` returns confidence-sorted results. A custom adapter that throws or returns a non-finite/out-of-range confidence is isolated and ignored instead of breaking planner execution.

## Design rules

1. **No action execution.** Controller methods remain Talox's single action path.
2. **No brittle selector catalogs.** Adapters describe semantic behavior and stable route patterns, while selectors come from live state.
3. **No hidden trust escalation.** Platform recognition does not change content trust, iframe trust, policy, or sanitizer behavior.
4. **Specific adapters may layer.** WooCommerce + WordPress is useful; unrelated adapters should not match.
5. **Failure is non-fatal.** Bad custom detection never blocks browsing.
