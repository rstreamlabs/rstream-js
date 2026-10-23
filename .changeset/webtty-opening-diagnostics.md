---
"@rstreamlabs/webtty": patch
---

Finish interrupted WebTransport openings when the transport closes normally, release streams that arrive after cancellation, and report one terminal error. Redact endpoint credentials in connection diagnostics and explain identifiable browser security errors without assuming every failure is a CSP violation.
