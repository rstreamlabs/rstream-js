# Contributing to the JavaScript SDKs

Keep each package focused on its API boundary. The runtime owns native Node.js tunnel connections, `tunnels` owns Engine HTTP APIs, and `rstream` owns Control plane APIs. Browser packages must remain usable without Node-only dependencies or local credential access.

The [roadmap](roadmap/) keeps runtime capabilities and contributor toolchain changes separate.

## Workspace setup

Use Node.js 24, matching the repository’s CI, and the npm version declared in `package.json`. Published SDK runtime compatibility is separate from the workspace’s development tools. Install from the repository root:

```sh
npm ci
```

Build workspace dependencies before checking a package:

```sh
npm run build
npm run type-check
npm run lint
npm test
```

Use the affected package’s scripts for focused development. Runtime tests include a local TLS/protobuf fixture; real-engine tests are opt-in and need an explicitly configured engine. See the [runtime guide](packages/runtime/README.md) for those commands.

## Changes

Follow [CODING_STYLE.md](CODING_STYLE.md), preserve package exports and update the owning guide when changing public behavior. Keep cross-package API changes coordinated, including configuration precedence and unsupported-feature errors. Add a regression test at the boundary affected by the change.

Use `npm run changeset` for published package changes that need a release entry. Documentation-only changes do not need a package version bump. See [Security](SECURITY.md) for private vulnerability reporting.

## Protocol security

Review WebTTY authentication and cryptographic changes across the Node and browser runtimes. Preserve protocol-bound endpoint proofs, workspace credential verification, replay rejection and shared Go/C++ vectors. Keep security audit results outside the source tree and include the affected runtime checks in the release review.
