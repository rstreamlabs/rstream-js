---
"@rstreamlabs/rstream": minor
---

Add typed credential ownership and an opt-in schema for bounded workspace-derived
authentication proofs. Keep legacy token schemas and inferred types unchanged.
Workspace proofs require an explicit permission set, expiry and backing credential
reference so compatible server readers can validate the credential's current state.
