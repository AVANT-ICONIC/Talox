# Cross-origin iframe trust

Talox can create frame-scoped CDP sessions for cross-origin iframes. Reachability is not the same thing as trust: an embedded frame may be technically controllable while its content belongs to an unrelated third party.

`CrossOriginManager` therefore attaches an explicit trust decision to every tracked cross-origin session and uses the same trust vocabulary as Talox page state: `first-party` or `external`, with `opaque` reserved for URLs that have no usable origin.

## Security model

The default policy is intentionally conservative:

| Frame relationship | Trust result |
| --- | --- |
| Same origin | `first-party` / trusted |
| Exact origin configured through `trustedDomains` | `first-party` / trusted |
| Any other cross-origin HTTP(S) origin | `external` / untrusted |
| Opaque origin (`data:`, `about:`, etc.) | `opaque` / untrusted |
| Invalid URL | `opaque` / untrusted |

Talox does **not** automatically trust sibling or child subdomains. For example, `cdn.example.com` is not trusted merely because the parent is `app.example.com`. Wildcard allowlists are deliberately unsupported.

## Existing Talox setting

The canonical configuration is the existing `TaloxSettings.trustedDomains` setting. `CrossOriginManager` accepts the same name directly:

```ts
import { CrossOriginManager } from "talox";

const frames = new CrossOriginManager({
  trustedDomains: [
    "payments.example.net",
    "https://identity.example.org",
  ],
});
```

Bare domains are interpreted conservatively as HTTPS origins. URL entries are normalized to their exact origin, so paths do not broaden or narrow the boundary:

```ts
new CrossOriginManager({
  trustedDomains: ["https://payments.example.net/sdk/v2"],
});
// trusts https://payments.example.net exactly
```

A different scheme or port remains a different origin. `trustedOrigins` remains accepted as a deprecated direct-manager compatibility alias; new code should use `trustedDomains`.

## Stable frame identity

Frame IDs are attached to the Playwright `Frame` object, not derived from its current URL. This matters when an iframe navigates: Talox removes the previous session and trust decision before evaluating the new origin, so an old trusted ID cannot remain authorized after navigation to an external origin.

Named frames keep their familiar name when it is available and unique. Unnamed or duplicate names receive a monotonic ID that is not reused during the manager lifetime.

## Inspect trust

Every tracked `IframeSession` includes `trust`:

```ts
const session = frames.getSession("checkout-frame");
console.log(session?.trust);

// {
//   level: "external",
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

The trusted variant rejects unknown, opaque, and default-denied external frames before sending a CDP command. CDP sessions are created for the target `Frame`, not the parent `Page`, so a trust gate cannot accidentally authorize a command against the wrong browsing context.

This separation keeps existing automation behavior available while giving new code an enforceable trust boundary instead of a warning string everyone is expected to remember forever.
