# @rstreamlabs/webtty

## 1.12.0

### Minor Changes

- 4711c78: Add capability-gated, bounded detached WebTTY executions with a stable managed session identity. A reader can disconnect and an authorized participant can attach to the same execution without starting the command again.

  Explicit termination sends the protocol request and waits for the native process result; disconnect only releases the reader. Preserve the actual exit code and final output, keep unconfirmed results unknown, and bound captured output and termination waits. Older Engine and native capabilities are checked independently of authorization.

  React terminals forward attachment and managed execution options and expose the acknowledged session through `onSessionReady`. Unmounting disconnects the reader, and stopping one session leaves other readers active. Tunnel session schemas retain the execution deadline metadata.

## 1.11.2

### Patch Changes

- 7d7e2e3: Finish interrupted WebTransport openings when the transport closes normally, release streams that arrive after cancellation, and report one terminal error. Redact endpoint credentials in connection diagnostics and explain identifiable browser security errors without assuming every failure is a CSP violation.

## 1.11.1

### Patch Changes

- Updated dependencies [3a36c67]
  - @rstreamlabs/filesystem@0.3.0

## 1.11.0

### Minor Changes

- Add a shared read-only WebRTC filesystem transport with server discovery, real browser/Node DataChannels, rstream ICE configuration, bounded streaming, authorization renewal and ICE restart. Keep WebDAV writes unchanged when selected and reject every write in WebRTC mode. WebTTY uses the common client while preserving its public errors. Expose fs_backend in inventory and add reusable picker-first browser disk download/progress helpers.
- Resolve advertised WebTTY transports consistently across discovery, hosted commands, and React clients. Preserve private engine-only connections, reject contradictory metadata before dialing, and bound framing, cancellation, and connection cleanup. Provide a per-client Node WebSocket factory for hosted commands.

### Patch Changes

- Introduce a shared filesystem backend interface and WebDAV client for the CLI file browser and WebTTY. Preserve WebTTY exports and write APIs while adding streaming reads and native download URLs, with exact filename encoding and cancellation support.
- Updated dependencies
- Updated dependencies
  - @rstreamlabs/filesystem@0.2.0

## 1.10.0

### Minor Changes

- 79a894d: Add a WebTTY P-256/HKDF-SHA256/AES-256-GCM random-nonce profile for interoperability with rstream Go FIPS builds, including authenticated negotiation, local trust, and WebTransport support.

## 1.9.1

### Patch Changes

- 8d10a34: Update build and runtime dependencies to their latest supported releases.

## 1.9.0

### Minor Changes

- 87b153d: Add managed WebTTY runtime support, authenticated end-to-end WebTTY sessions, session recording helpers, and WebTTY MCP/runtime schemas.

## 1.7.0

### Minor Changes

- 35b4b2a: Add reusable WebTTY command execution and WebDAV filesystem helpers for browser and agent workflows.

## 1.6.5

### Patch Changes

- d740fb9: Refresh package README documentation with consistent package descriptions, installation guidance, usage examples, configuration notes, and development commands.

## 1.6.4

### Patch Changes

- a8c63f6: Harden token, tunnel, TURN, watch, and WebTTY runtime behavior ahead of public release and add regression coverage for security-sensitive flows.

## 1.6.3

### Patch Changes

- 8f7685d: Migrate `@rstreamlabs/rstream` to Zod v4, extend auth token support with workspace and project scoping plus PAT token endpoints, and refresh the tunnel permission filter typing.

  Refresh internal typing and compatibility fixes in `@rstreamlabs/utils` and `@rstreamlabs/webtty`.

  Refresh workspace compatibility metadata alongside the upgraded toolchain.

## 1.6.2

### Patch Changes

- 52259c7: minor improvments in rstream react provider

## 1.6.1

### Patch Changes

- eaba2d8: update ci workflows

## 1.6.0

### Minor Changes

- bc024f0: Update dependencies, update rstream schemas

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
