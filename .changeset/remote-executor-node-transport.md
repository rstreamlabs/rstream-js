---
"@rstreamlabs/webtty": patch
---

Preserve an explicit WebSocket factory in WebTTYRemoteExecutor so Node command execution uses its configured transport rather than the ambient global WebSocket.
