---
"@rstreamlabs/rstream": patch
---

Reject unsupported filter record keys instead of silently dropping their
constraints. Preserve existing key validation and describe the same boundary in
generated JSON Schema.
