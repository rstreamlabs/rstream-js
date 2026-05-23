---
"@rstreamlabs/rstream": major
"@rstreamlabs/tunnels": major
---

Move the shared fine-grained token contract to canonical `resources.tunnels`, remove the legacy `scopes` and `tunnelsGrants` token creation parameters, and expose the shared Zod schemas from `@rstreamlabs/rstream`.

Expose `ttlSeconds` on managed TURN credential issuance and validate the shared TURN credential request contract against the runtime one-hour TTL limit.
