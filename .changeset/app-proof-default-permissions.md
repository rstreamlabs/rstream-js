---
"@rstreamlabs/rstream": patch
---

Accept App tokens with omitted permission claims, matching the default output of
`createClientCredentialsToken`. Explicit permission restrictions remain intact;
workspace-derived tokens still require their bounded permission set and source.
