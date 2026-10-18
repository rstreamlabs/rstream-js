---
"@rstreamlabs/filesystem": minor
---

Add guarded, streamed uploads with owner-side integrity checks and recoverable receipts, conditional removal, and revision-bound reads. Preserve revision metadata in listings. Unsupported owners refuse guarded mutations without an unconditional fallback; recovering an upload never retransmits its content.
