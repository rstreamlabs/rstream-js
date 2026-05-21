# @rstreamlabs/tunnels

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

- 53142fd: Scope minted auth tokens to the configured project by default, update watch-token validation and Tunnel access schemas for explicit AND/OR grants, and keep existing PAT endpoint claims readable while new tokens continue using the canonical endpoint claim.
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

- c0d0ecd: Preserve logical tunnel grant filters when validating auth token scopes.

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
