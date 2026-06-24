# @rstreamlabs/tunnels

## 3.4.0

### Minor Changes

- 87b153d: Add managed WebTTY runtime support, authenticated end-to-end WebTTY sessions, session recording helpers, and WebTTY MCP/runtime schemas.

### Patch Changes

- Updated dependencies [87b153d]
  - @rstreamlabs/rstream@3.3.0

## 3.2.1

### Patch Changes

- 8c709f5: Add webhook signing helpers for local receivers and webhook-compatible event forwarding.

## 3.2.0

### Minor Changes

- cd166c3: Add managed tunnel project event listing, webhook Control plane APIs, and lifecycle-only webhook event parsing.

### Patch Changes

- Updated dependencies [cd166c3]
  - @rstreamlabs/rstream@3.1.0

## 3.1.0

### Minor Changes

- 35b4b2a: Expose WebTTY capability, exec path, and filesystem sidecar metadata from tunnel labels.

## 3.0.0

### Major Changes

- 93575ab: Move the shared fine-grained token contract to canonical `resources.tunnels`, remove the legacy `scopes` and `tunnelsGrants` token creation parameters, and expose the shared Zod schemas from `@rstreamlabs/rstream`.

  Expose `ttlSeconds` on managed TURN credential issuance and validate the shared TURN credential request contract against the runtime one-hour TTL limit.

### Patch Changes

- Updated dependencies [93575ab]
  - @rstreamlabs/rstream@3.0.0

## 2.0.0

### Major Changes

- 7d28daa: Centralize shared token, tunnel resource, tunnel, and schema helper contracts in `@rstreamlabs/rstream`.

  `@rstreamlabs/tunnels` now consumes those canonical schemas without re-exporting them. Import token schemas from `@rstreamlabs/rstream/auth-token`, tunnel schemas from `@rstreamlabs/rstream/tunnel`, TURN schemas from `@rstreamlabs/rstream/turn`, and schema helpers from `@rstreamlabs/rstream/zod`.

  Auth tokens with `sourceCredentialId` and `sourceCredentialUpdatedAt` are accepted by the canonical token schema, fixing browser watch-token validation for delegated WebTTY demo sessions.

### Patch Changes

- Updated dependencies [7d28daa]
  - @rstreamlabs/rstream@2.1.5

## 1.0.11

### Patch Changes

- Ship the JSON Web Token type dependency with the packages so TypeScript consumers can compile declarations without adding `@types/jsonwebtoken` themselves.
- Updated dependencies
  - @rstreamlabs/rstream@2.1.4

## 1.0.10

### Patch Changes

- d740fb9: Refresh package README documentation with consistent package descriptions, installation guidance, usage examples, configuration notes, and development commands.
- Updated dependencies [d740fb9]
  - @rstreamlabs/rstream@2.1.3

## 1.0.9

### Patch Changes

- 53142fd: Scope minted auth tokens to the configured project by default, update watch-token validation and Tunnel access schemas for explicit AND/OR resources, and keep existing PAT endpoint claims readable while new tokens continue using the canonical endpoint claim.
- Updated dependencies [53142fd]
  - @rstreamlabs/rstream@2.1.2

## 1.0.8

### Patch Changes

- a8c63f6: Harden token, tunnel, TURN, watch, and WebTTY runtime behavior ahead of public release and add regression coverage for security-sensitive flows.
- Updated dependencies [a8c63f6]
  - @rstreamlabs/rstream@2.1.1

## 1.0.7

### Patch Changes

- 01133ff: Export the rstream engine OpenAPI document from the tunnels SDK package.

## 1.0.6

### Patch Changes

- 202e8a2: Add stable domain, published port, and upstream TLS fields to tunnel and stream summary schemas, and prefer the stable published authority when parsing WebTTY servers.

## 1.0.5

### Patch Changes

- Add ECH field to TLS info schema.

## 1.0.4

### Patch Changes

- a3a449a: Add protocol and curve fields to TLS info schema

## 1.0.3

### Patch Changes

- 196befe: Add TLS details to stream summary endpoint schemas.

## 1.0.2

### Patch Changes

- c0d0ecd: Preserve logical tunnel resource filters when validating auth token scopes.

## 1.0.1

### Patch Changes

- Updated dependencies [79f0a4d]
  - @rstreamlabs/rstream@2.1.0

All notable changes to this package will be documented in this file.

## 1.0.0

### Major Changes

- Initial public release of `@rstreamlabs/tunnels`.

  This package contains the rstream Engine API SDK:
  engine discovery for managed projects, direct engine access for self-hosted
  deployments, tunnel and client APIs, watch helpers, webhook helpers,
  fine-grained app token creation, and TURN credential helpers.
