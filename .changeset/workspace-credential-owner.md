---
"@rstreamlabs/rstream": minor
---

Add typed credential ownership and an opt-in schema for bounded workspace-derived
authentication proofs. Keep legacy token schemas and inferred types unchanged.
Workspace proofs require an explicit permission set, expiry and backing credential
reference so compatible server readers can validate the credential's current state.

Add an owner-aware caller identity method that preserves effective permissions and
resource limits. Keep the existing `whoami()` response and type unchanged, and
accept historical personal identity responses from older servers.
