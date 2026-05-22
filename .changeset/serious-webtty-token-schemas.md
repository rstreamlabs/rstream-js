---
"@rstreamlabs/react": patch
"@rstreamlabs/rstream": patch
"@rstreamlabs/tunnels": major
---

Centralize shared token, tunnel grant, tunnel, and schema helper contracts in `@rstreamlabs/rstream`.

`@rstreamlabs/tunnels` now consumes those canonical schemas without re-exporting them. Import token schemas from `@rstreamlabs/rstream/auth-token`, tunnel schemas from `@rstreamlabs/rstream/tunnel`, TURN schemas from `@rstreamlabs/rstream/turn`, and schema helpers from `@rstreamlabs/rstream/zod`.

Auth tokens with `sourceCredentialId` and `sourceCredentialUpdatedAt` are accepted by the canonical token schema, fixing browser watch-token validation for delegated WebTTY demo sessions.
