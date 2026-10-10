---
"@rstreamlabs/rstream": minor
"@rstreamlabs/tunnels": minor
"@rstreamlabs/runtime": minor
---

Support certificate-authenticated Engine HTTP APIs in Node applications through anonymous, cached discovery. Reuse HTTPS pools for inventory, SSE watches and managed TURN credentials, and expose the HTTP client from the native runtime.

Align automatic TURN issuance with Go: derive eligible PAT/APP credentials locally when metadata is available, otherwise use the Control plane with Engine fallback on availability failures. Certificate clients use Engine directly. Bound requests and response sizes, preserve identity and permissions, expose typed HTTP errors, and close owned transports explicitly.
