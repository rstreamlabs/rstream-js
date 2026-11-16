---
"@rstreamlabs/react": patch
---

Use the application's React instance instead of installing a second runtime through the SDK's renderer dependencies. Require React 19.2.8 or newer within React 19, matching the APIs the SDK uses, and reject unsupported React 18 installations explicitly.
