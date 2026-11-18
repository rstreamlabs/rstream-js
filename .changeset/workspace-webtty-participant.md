---
"@rstreamlabs/tunnels": minor
---

Expose source credential, workspace ownership and authentication deadlines on
WebTTY participants. Keep existing personal participant responses and forward
compatible event payloads supported.

Accept source-bound workspace Tokens in SSE/WebSocket inventory watchers through
the shared credential schema. Preserve bounded lifetimes, list-only resources,
and existing personal/application Token behavior without fabricating a user.
