# @rstreamlabs/runtime

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
