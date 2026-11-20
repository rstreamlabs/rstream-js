# `@rstreamlabs/runtime`

rstream makes services reachable through outbound connections, without opening inbound ports on their hosts. This package embeds that connection in a Node.js process so the application can own its tunnels and accepted streams.

Use this package when a Node.js process needs to create bytestream tunnels,
accept incoming tunnel streams, dial private bytestream tunnels, or attach a
tunnel to a Node HTTP server. This package is intentionally Node-only: it uses
TCP, TLS, long-lived sockets, and Node stream primitives.

For Engine API inventory, events, webhooks, token minting, and TURN helpers, use
[`@rstreamlabs/tunnels`](https://github.com/rstreamlabs/rstream-js/blob/main/packages/tunnels/README.md). For Control plane APIs, use
[`@rstreamlabs/rstream`](https://github.com/rstreamlabs/rstream-js/blob/main/packages/rstream/README.md).

## Install

Use Node.js 24 and npm for the examples on this page.

```sh
npm install @rstreamlabs/runtime
```

## HTTP tunnel server

Start with the [published-package example](https://github.com/rstreamlabs/rstream-js/blob/main/README.md#serve-http-from-nodejs).
The [HTTP and WebSocket walkthrough](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/000-http-and-websocket.md)
runs the checkout programs with an authorized context, an HTTP client and
a WSS caller. The runtime passes accepted streams to your Node HTTP server's
normal request and upgrade handlers.

## Published TCP tunnel

[Connect to a private or TCP service](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/001-private-services.md#choose-raw-tcp-publication)
covers raw addresses and port reservations.

## WebSocket upgrades

Use HTTP/1.1 and the Node server's `upgrade` event. The
[WebSocket walkthrough](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/000-http-and-websocket.md#open-a-websocket)
shows the server, WSS client and expected message.

## Dial a private bytestream tunnel

[Run an origin and dial it by name or ID](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/001-private-services.md).
The dial returns a Node `Duplex` that carries the application's protocol.

## Control liveness and established streams

[Control loss](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/002-lifecycle.md#recover-after-loss-of-control)
ends admission. Observe each active stream independently.

## Application lifecycle

[Own the runtime and its streams](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/002-lifecycle.md)
when the application needs bounded cancellation, cleanup and recovery.

## Configuration

Reuse the CLI context on a development workstation. In a service, choose
a project-scoped identity and configure it independently. The
[runtime configuration guide](https://github.com/rstreamlabs/rstream-js/blob/main/docs/001-runtime-configuration.md)
covers precedence, shared contexts, environment variables, certificates
and transport options.

Connect to a known Engine with a bearer token.

```ts
import { Client } from "@rstreamlabs/runtime";

const client = new Client({
  engine: "engine.example.com:443",
  token: process.env.RSTREAM_AUTHENTICATION_TOKEN,
});
```

Use application credentials with a managed project endpoint to resolve the
Engine and mint a native tunnel token. Grant the application
`account.projects.read-only` for discovery and the Engine permissions
required by its tunnel operations. Leave `RSTREAM_ENGINE` unset for
managed discovery.

```ts
import { Client } from "@rstreamlabs/runtime";

const client = new Client({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
  readConfigFile: false,
  requireToken: true,
});
```

## Supported runtime surface

Supported:

- control-channel TLS transport with ALPN `rstrm/1`
- HTTP CONNECT proxying for the control-channel TLS transport through `transport.proxy.http`
- HTTPS proxy verification through `transport.proxy.tls.caFile`,
  `transport.proxy.tls.serverName`, and
  `transport.proxy.tls.insecureSkipVerify`
- opt-in process proxy discovery through `transport.proxy.fromEnvironment`
- bytestream tunnel creation and close
- published TCP creation with ephemeral or reserved project ports
- inbound bytestream accept
- private bytestream dial
- HTTP/1.1 and h2c upstream integration through Node HTTP servers
- WebSocket upgrades over HTTP/1.1 tunnels
- config-file and environment resolution compatible with the Go/C++ SDK model

Not supported:

- datagram tunnels
- QUIC transport
- SOCKS5 proxying
- HTTP/3 / WebTransport tunnels
- browser runtimes
- custom DNS resolver settings from config files

Unsupported features fail during configuration or tunnel creation with explicit
`RuntimeError.code` values.

## Certificate-authenticated Engine HTTP methods

Inventory and SSE watch methods reuse the resolved file-based mTLS identity and
one owned Engine HTTP client. The dedicated API authority is discovered anonymously
and cached in memory; no extra YAML address or login is needed. These Node.js API
methods use HTTPS/TCP. Certificate WebSocket watches and HTTP/3 are not supported
by the Node.js adapter. Close the runtime client at shutdown to release its HTTP
connections, in addition to closing native control channels/tunnels you own.
Control plane administration and project-region resolution still require tokens;
use an explicit Engine address for certificate-only devices.

## Tests

See the [runtime test guide](https://github.com/rstreamlabs/rstream-js/blob/main/packages/runtime/test/README.md) for local fixtures and
opt-in Engine checks. Follow [Contributing](https://github.com/rstreamlabs/rstream-js/blob/main/CONTRIBUTING.md) to
build and test the workspace.
