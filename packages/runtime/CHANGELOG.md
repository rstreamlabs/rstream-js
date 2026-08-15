# @rstreamlabs/runtime

## 0.8.0

### Minor Changes

- 1316929: Negotiate bounded control-channel liveness, preserve accepted payload streams across unexpected control loss, and harden concurrent proxy connection lifecycle handling.

### Patch Changes

- Updated dependencies [42f6dac]
  - @rstreamlabs/tunnels@3.8.1

## 0.7.1

### Patch Changes

- 8d10a34: Update build and runtime dependencies to their latest supported releases.
- Updated dependencies [987cc6c]
- Updated dependencies [8d10a34]
  - @rstreamlabs/rstream@3.8.0
  - @rstreamlabs/tunnels@3.8.0

## 0.7.0

### Minor Changes

- 79cab99: Add Edge Network stream redirection and cross-region routing policy support.

### Patch Changes

- Updated dependencies [79cab99]
  - @rstreamlabs/rstream@3.7.0
  - @rstreamlabs/tunnels@3.7.0

## 0.6.0

### Minor Changes

- fec626d: Add published TCP tunnel metadata and runtime creation with ephemeral or reserved project ports.

### Patch Changes

- Updated dependencies [fec626d]
  - @rstreamlabs/rstream@3.6.0
  - @rstreamlabs/tunnels@3.6.2

## 0.5.0

### Minor Changes

- d67d55f: Add shared `auto` tunnel transport selection, resolving to TLS in the JavaScript runtime, and expose datagram guaranteed-delivery metadata through the shared tunnel schema.

### Patch Changes

- Updated dependencies [d67d55f]
  - @rstreamlabs/rstream@3.5.0
  - @rstreamlabs/tunnels@3.6.1

## 0.4.2

### Patch Changes

- Updated dependencies [6531b70]
  - @rstreamlabs/rstream@3.4.0
  - @rstreamlabs/tunnels@3.6.0

## 0.4.1

### Patch Changes

- Updated dependencies [943fc3f]
  - @rstreamlabs/tunnels@3.5.0

## 0.4.0

### Minor Changes

- 87b153d: Add managed WebTTY runtime support, authenticated end-to-end WebTTY sessions, session recording helpers, and WebTTY MCP/runtime schemas.

### Patch Changes

- Updated dependencies [87b153d]
  - @rstreamlabs/rstream@3.3.0
  - @rstreamlabs/tunnels@3.4.0

## 0.2.10

### Patch Changes

- Updated dependencies [8c709f5]
  - @rstreamlabs/tunnels@3.2.1

## 0.2.9

### Patch Changes

- Updated dependencies [cd166c3]
  - @rstreamlabs/rstream@3.1.0
  - @rstreamlabs/tunnels@3.2.0

## 0.2.8

### Patch Changes

- Updated dependencies [35b4b2a]
  - @rstreamlabs/tunnels@3.1.0

## 0.2.7

### Patch Changes

- Updated dependencies [93575ab]
  - @rstreamlabs/rstream@3.0.0
  - @rstreamlabs/tunnels@3.0.0

## 0.2.6

### Patch Changes

- Updated dependencies [7d28daa]
  - @rstreamlabs/rstream@2.1.5
  - @rstreamlabs/tunnels@2.0.0

## 0.2.5

### Patch Changes

- 611b29f: Support `transport.proxy.tls` for HTTPS proxy verification and reject standalone proxy TLS configuration.

## 0.2.4

### Patch Changes

- Updated dependencies
  - @rstreamlabs/rstream@2.1.4
  - @rstreamlabs/tunnels@1.0.11

## 0.2.3

### Patch Changes

- c6b65a3: Parse the shared hardened credential storage and transport proxy configuration
  shapes, reject unsupported runtime backends explicitly, and close failed HTTP
  CONNECT proxy sockets deterministically.

## 0.2.2

### Patch Changes

- 0d2189c: Simplify the HTTP runtime example so the minimal sample does not enable rstream-authenticated published access.

## 0.2.1

### Patch Changes

- f367b6c: Bundle protobufjs in the runtime package so the published ESM entrypoint can be imported by Node.js from a fresh project.

## 0.2.0

### Minor Changes

- 56b18ec: Add the Node.js tunnel runtime SDK with bytestream tunnel creation, private bytestream dialing, HTTP server serving, WebSocket upgrade support, shared runtime configuration resolution, and real-engine E2E coverage.

### Patch Changes

- d740fb9: Refresh package README documentation with consistent package descriptions, installation guidance, usage examples, configuration notes, and development commands.
- Updated dependencies [d740fb9]
  - @rstreamlabs/rstream@2.1.3
  - @rstreamlabs/tunnels@1.0.10

All notable changes to this package will be documented in this file.

## 0.1.0

### Minor Changes

- Initial Node.js runtime SDK package for rstream bytestream tunnels.
