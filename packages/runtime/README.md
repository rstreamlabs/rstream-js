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

The SDK supports the same configuration model as the Go and C++ SDKs:

| Variable                                                | Purpose                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RSTREAM_CONFIG`                                        | Path to the rstream configuration file. Defaults to `~/.rstream/config.yaml`.                                                      |
| `RSTREAM_CONTEXT`                                       | Name of the context to select during config-based resolution.                                                                      |
| `RSTREAM_API_URL`                                       | Control plane API URL used by managed project resolution.                                                                          |
| `RSTREAM_REGION`                                        | Authorized region to select for a managed project.                                                                                 |
| `RSTREAM_CONTROL_PLANE_HEADERS`                         | Additional Control plane request headers encoded as a JSON object.                                                                 |
| `RSTREAM_ENGINE`                                        | Engine endpoint used when no engine is provided explicitly.                                                                        |
| `RSTREAM_AUTHENTICATION_TOKEN`                          | Bearer token for token-authenticated runtime connections.                                                                          |
| `RSTREAM_MTLS_CERT_FILE`                                | Client certificate file for mTLS agent authentication.                                                                             |
| `RSTREAM_MTLS_KEY_FILE`                                 | Client private key file for mTLS agent authentication.                                                                             |
| `RSTREAM_TUNNEL_TRANSPORT`                              | `auto`, `tls`, or `quic`. `auto` uses TLS; explicit `quic` fails because this runtime has no QUIC implementation.                  |
| `RSTREAM_QUIC_TRANSPORT`                                | Legacy selector. `1` requests QUIC and therefore fails in this runtime; prefer `RSTREAM_TUNNEL_TRANSPORT`.                         |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY` | Used only when `transport.proxy.fromEnvironment: true` is set. HTTP and HTTPS proxies are supported for the TLS runtime transport. |

For an engine using a private CA, set Node’s `NODE_EXTRA_CA_CERTS` to the CA PEM file before starting the process. The engine address must match its certificate. Programmatic clients can also provide the `tls` client option to configure trust and the verification name.

Explicit SDK options take precedence over environment and config-file values.
The equivalent client option is `tunnelTransport`. In shared YAML, use
`transport.mode`. Omitting the setting or choosing `auto` selects TLS because
the Node runtime currently implements only TLS. This fallback is a documented
capability rule; an explicit `quic` request is never silently downgraded.
The runtime reads process proxy variables, not desktop proxy preference stores
such as macOS System Settings or Windows Internet Options.
For HTTPS proxies issued by a private CA, use `transport.proxy.tls.caFile` in
the shared rstream config. `transport.proxy.tls.serverName` overrides the proxy
SNI and certificate verification name, and
`transport.proxy.tls.insecureSkipVerify` disables HTTPS proxy verification for
diagnostics. The proxy TLS settings apply to the proxy hop only; the runtime
still verifies the rstream engine TLS session separately after CONNECT succeeds.
Token authentication and mTLS engine authentication are mutually exclusive. When
`noToken: true` is set, the SDK does not read or send stored tokens.
Region selection requires a managed project endpoint and cannot be combined
with an explicit engine. Additional Control plane headers are for deployment
access layers; authentication, forwarding, and hop-by-hop headers are reserved.
Malformed values and case-insensitive duplicates are rejected before network
I/O.

```ts
import { Client } from "@rstreamlabs/runtime";

const client = new Client({
  engine: "engine.example.com:443",
  token: process.env.RSTREAM_AUTHENTICATION_TOKEN,
});
```

Managed project resolution is also available:

```ts
import { Client } from "@rstreamlabs/runtime";

const client = new Client({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
});
```

Shared configurations using `auth.mtls.storage.kind: exec` require the Go SDK
or CLI. The Node.js runtime rejects this backend with
`ERR_RSTREAM_UNSUPPORTED_CONFIG` when that context or environment is selected;
it never launches the helper. Other contexts in the same file remain usable.
Browser SDKs do not load the local configuration file or execute local programs.

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

## Tests

See the [runtime test guide](https://github.com/rstreamlabs/rstream-js/blob/main/packages/runtime/test/README.md) for local fixtures and
opt-in Engine checks. Follow [Contributing](https://github.com/rstreamlabs/rstream-js/blob/main/CONTRIBUTING.md) to
build and test the workspace.

### Certificate-authenticated Engine HTTP methods

Inventory and SSE watch methods reuse the resolved file-based mTLS identity and
one owned Engine HTTP client. The dedicated API authority is discovered anonymously
and cached in memory; no extra YAML address or login is needed. These Node.js API
methods use HTTPS/TCP. Certificate WebSocket watches and HTTP/3 are not supported
by the Node.js adapter. Close the runtime client at shutdown to release its HTTP
connections, in addition to closing native control channels/tunnels you own.
Control plane administration and project-region resolution still require tokens;
use an explicit Engine address for certificate-only devices.
