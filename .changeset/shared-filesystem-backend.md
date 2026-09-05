---
"@rstreamlabs/filesystem": patch
"@rstreamlabs/webtty": patch
---

Introduce a shared filesystem backend interface and WebDAV client for the CLI file browser and WebTTY. Preserve WebTTY exports and write APIs while adding streaming reads and native download URLs, with exact filename encoding and cancellation support.
