---
"@rstreamlabs/rstream": minor
"@rstreamlabs/tunnels": major
"@rstreamlabs/react": major
---

Support independent client and tunnel list scopes with matching allow/deny,
filter and field-selection schemas. New client scopes require a compatible
Engine rollout before issuance; omitting them preserves legacy visibility.

Inventory list and watch APIs now return `ListedClient` and `ListedTunnel`
with optional fields, matching projected Engine responses. TypeScript
consumers must check fields before use or request them in their list scope.
Full entity and webhook models remain unchanged.

React inventory replaces snapshots, handles visibility transitions and hides
stale data across authentication changes. WebTTY discovery tolerates projected
objects and skips rows without the identifiers and metadata it needs.
