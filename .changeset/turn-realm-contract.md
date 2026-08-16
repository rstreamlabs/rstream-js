---
"@rstreamlabs/rstream": patch
"@rstreamlabs/tunnels": patch
---

Expose the TURN relay domain and authentication realm independently in managed project metadata, use each value for its correct role during local PAT and application credential derivation, and read the local PAT endpoint identity directly from its signed claims.
