# @rstreamlabs/tunnels

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

  This package contains the rstream tunnels engine and data-plane SDK:
  engine discovery for managed projects, direct engine access for self-hosted
  deployments, tunnel and client APIs, watch helpers, webhook helpers,
  fine-grained app token creation, and TURN credential helpers.
