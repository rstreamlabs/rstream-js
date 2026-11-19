---
"@rstreamlabs/runtime": patch
---

Prevent unhandled internal rejections when a control channel closes before a tunnel creation or close write completes, while preserving the operation's rejection for its caller.
