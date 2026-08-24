# Cross-origin iframe trust

Talox can create CDP-backed sessions for cross-origin iframes. Reachability is not the same thing as trust: an embedded frame may be technically controllable while its content belongs to an unrelated third party.

`CrossOriginManager` therefore attaches an explicit trust decision to every tracked cross-origin session.

## Security model

The default policy is intentionally conservative:

| Frame relationship | Trust result |
| --- | --- |
| Same origin | `trusted` |
| Exact origin in `trustedOrigins` | `trusted` |
| Any other cross-origin HTTP(S) origin | `untrusted` |
| Opaque origin (`data:`, `about:`, etc.) | `opaque` / untrusted |
| Invalid URL | `opaque` / untrusted |

Talox does **not** automatically trust sibling or child subdomains. For example, `cdn.example.com` is not trusted merely because the parent is `app.example.com`. Wildcard allowlists are deliberately unsupported.

## Explicit trusted origins

```ts
import { CrossOriginManager } from "talox";

const frames = new CrossOriginManager({
  trustedOrigins: [
    "https://payments.example.net",
    "https://identity.example.org",
  ],
});
```

Allowlist entries are normalized to URL origins, so a path in configuration does not broaden or narrow the trust boundary:

```ts
new CrossOriginManager({
  trustedOrigins: ["https://payments.example.net/sdk/v2"],
});
// trusts https://payments.example.net exactly
```

A different scheme or port remains a different origin.

## Inspect trust

Every tracked `IframeSession` now includes `trust`:

```ts
const session = frames.getSession("checkout-frame");
console.log(session?.trust);

// {
//   level: "untrusted",
//   trusted: false,
//   reason: "cross-origin-default-deny",
//   origin: "https://unknown.example",
//   parentOrigin: "https://shop.example"
// }
```

You can also inspect without creating a browser session:

```ts
const decision = frames.assessTrust(
  "https://payments.example.net/embed",
  "https://shop.example.com/checkout",
);
```

Registry-style helpers make policy gates simple:

```ts
frames.isTrusted("checkout-frame");
frames.getTrust("checkout-frame");
frames.getTrustedSessions();
frames.getUntrustedSessions();
```

Unknown frame IDs are never considered trusted.

## Enforcement

`executeInFrame()` remains backward compatible and will execute against any tracked cross-origin session. Security-sensitive code should use `executeInTrustedFrame()`:

```ts
await frames.executeInTrustedFrame(
  "checkout-frame",
  "Runtime.evaluate",
  { expression: "document.title" },
);
```

The trusted variant rejects unknown, opaque, and default-denied frames before sending a CDP command.

This separation is intentional. Existing automation is not silently broken by a new policy layer, while new code can opt into an enforceable trust boundary instead of merely receiving a warning string and hoping everyone remembers it.
