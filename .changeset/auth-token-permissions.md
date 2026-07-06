---
"@rstreamlabs/rstream": minor
"@rstreamlabs/tunnels": minor
---

Let `createAuthToken` carry explicit `permissions`, so callers can request the read-only watch permission the engine and the `Watch` client require for URL-based (query-token) watch connections. Previously the minted permission was always `null`, so no watch query token created through the SDK was accepted by the engine.
