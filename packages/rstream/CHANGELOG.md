# @rstreamlabs/rstream

## 3.0.0

### Major Changes

- 93575ab: Move the shared fine-grained token contract to canonical `resources.tunnels`, remove the legacy `scopes` and `tunnelsGrants` token creation parameters, and expose the shared Zod schemas from `@rstreamlabs/rstream`.

  Expose `ttlSeconds` on managed TURN credential issuance and validate the shared TURN credential request contract against the runtime one-hour TTL limit.

## 2.1.5

### Patch Changes

- 7d28daa: Centralize shared token, tunnel resource, tunnel, and schema helper contracts in `@rstreamlabs/rstream`.

  `@rstreamlabs/tunnels` now consumes those canonical schemas without re-exporting them. Import token schemas from `@rstreamlabs/rstream/auth-token`, tunnel schemas from `@rstreamlabs/rstream/tunnel`, TURN schemas from `@rstreamlabs/rstream/turn`, and schema helpers from `@rstreamlabs/rstream/zod`.

  Auth tokens with `sourceCredentialId` and `sourceCredentialUpdatedAt` are accepted by the canonical token schema, fixing browser watch-token validation for delegated WebTTY demo sessions.

## 2.1.4

### Patch Changes

- Ship the JSON Web Token type dependency with the packages so TypeScript consumers can compile declarations without adding `@types/jsonwebtoken` themselves.

## 2.1.3

### Patch Changes

- d740fb9: Refresh package README documentation with consistent package descriptions, installation guidance, usage examples, configuration notes, and development commands.

## 2.1.2

### Patch Changes

- 53142fd: Scope minted auth tokens to the configured project by default, update watch-token validation and Tunnel access schemas for explicit AND/OR resources, and keep existing PAT endpoint claims readable while new tokens continue using the canonical endpoint claim.

## 2.1.1

### Patch Changes

- a8c63f6: Harden token, tunnel, TURN, watch, and WebTTY runtime behavior ahead of public release and add regression coverage for security-sensitive flows.

## 2.1.0

### Minor Changes

- 79f0a4d: Refine the JS SDK packaging for public release by splitting the Engine API into `@rstreamlabs/tunnels`, expanding Control plane API support in `@rstreamlabs/rstream`, and fixing React WebTTY and watch lifecycle regressions.

## 2.0.0

### Major Changes

- 8f7685d: Migrate `@rstreamlabs/rstream` to Zod v4, extend auth token support with workspace and project scoping plus PAT token endpoints, and refresh the tunnel permission filter typing.

  Refresh internal typing and compatibility fixes in `@rstreamlabs/utils` and `@rstreamlabs/webtty`.

  Refresh workspace compatibility metadata alongside the upgraded toolchain.

  Split the Control plane API surface from the Engine API SDK, add
  managed tunnels project discovery helpers, and add managed TURN credential
  creation helpers.

## 1.8.1

### Patch Changes

- 63001ec: fix events schemas

## 1.8.0

### Minor Changes

- 02c0149: add wsEvents, webhookEvents

## 1.7.1

### Patch Changes

- e4fce5c: fix stream.summary event schema

## 1.7.0

### Minor Changes

- 2ef73fb: add stream.summary event

## 1.6.4

### Patch Changes

- 9cf67af: fix webtty tunnel labels

## 1.6.3

### Patch Changes

- 40ac5a6: minor improvments in rstream react provider

## 1.6.2

### Patch Changes

- 52259c7: minor improvments in rstream react provider

## 1.6.1

### Patch Changes

- eaba2d8: update ci workflows

## 1.6.0

### Minor Changes

- bc024f0: Update dependencies, update rstream schemas

### Patch Changes

- f32826a: Fix typo in package description

## 1.5.0

### Minor Changes

- a2871a1: Update dependencies, add webtty server schema, update webtty demo page, fix hooks, update authentication model

## 1.4.0

### Minor Changes

- 4c46543: Update dependencies, update tunnel schema, update webtty demo page

## 1.3.0

### Minor Changes

- 76ddbd5: update rstream protocol version to 1.2

### Patch Changes

- b02e263: Fix compilation issue

## 1.2.0

### Minor Changes

- 215fa20: update NPM dependencies

## 1.1.0

### Minor Changes

- dbf7e37: set NPM packages access to public

## 1.0.0

### Major Changes

- 29d8e24: Initial release of all packages
