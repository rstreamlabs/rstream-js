# `@rstreamlabs/runtime`

Node.js runtime SDK for the rstream tunnel protocol.

Use this package when a Node.js process needs to create bytestream tunnels,
accept incoming tunnel streams, dial private bytestream tunnels, or attach a
tunnel to a Node HTTP server. This package is intentionally Node-only: it uses
TCP, TLS, long-lived sockets, and Node stream primitives.

For Engine API inventory, events, webhooks, token minting, and TURN helpers, use
[`@rstreamlabs/tunnels`](../tunnels/README.md). For Control plane APIs, use
[`@rstreamlabs/rstream`](../rstream/README.md).

## Install

```sh
npm install @rstreamlabs/runtime
```

## HTTP tunnel server

```ts
import http from "node:http";
import os from "node:os";
import { Client } from "@rstreamlabs/runtime";

const client = Client.fromEnv();
const ctrl = await client.connect();

const tunnel = await ctrl.createTunnel({
  protocol: "http",
  httpVersion: "http/1.1",
  publish: true,
});

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(os.hostname());
});

console.log("Server accessible at:", await tunnel.forwardingAddress());
await tunnel.serve(server);
```

`serve()` feeds accepted tunnel streams into the regular Node HTTP server
connection path. Existing `request`, `upgrade`, timeout, and server lifecycle
handlers continue to work as they do on a local TCP listener. `serveHttp()` is
also available when a call site benefits from the more explicit name.

Set `mtlsAuth: true` to require a registered client certificate for requests
entering the published tunnel URL. This is separate from agent authentication:
the Node process can authenticate to the engine with a token or with
`RSTREAM_MTLS_CERT_FILE` / `RSTREAM_MTLS_KEY_FILE`, while `mtlsAuth` protects
downstream clients reaching the public tunnel endpoint.

## WebSocket upgrades

WebSocket works over an HTTP/1.1 bytestream tunnel because the SDK passes the
raw stream to Node's HTTP server. Handle `upgrade` on the server or attach a
WebSocket library that integrates with `http.Server`.

```ts
import http from "node:http";
import { WebSocketServer } from "ws";
import { Client } from "@rstreamlabs/runtime";

const ctrl = await Client.fromEnv().connect();
const tunnel = await ctrl.createTunnel({
  protocol: "http",
  httpVersion: "http/1.1",
  publish: true,
});

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send("connected through rstream");
  });
});

console.log(await tunnel.forwardingAddress());
await tunnel.serve(server);
```

## Dial a private bytestream tunnel

```ts
import { Client } from "@rstreamlabs/runtime";

const client = Client.fromEnv();
const stream = await client.dial("private-api");

stream.write("ping\n");
stream.on("data", (chunk) => {
  process.stdout.write(chunk);
});
```

The returned object is a regular Node `Duplex` stream backed by the rstream
bytestream connection. You can pipe it, wrap it with `tls.connect({ socket })`,
or adapt it to protocol clients that accept a custom stream.

## Configuration

The SDK supports the same configuration model as the Go and C++ SDKs:

| Variable                                                | Purpose                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RSTREAM_CONFIG`                                        | Path to the rstream configuration file. Defaults to `~/.rstream/config.yaml`.                                                      |
| `RSTREAM_CONTEXT`                                       | Name of the context to select during config-based resolution.                                                                      |
| `RSTREAM_API_URL`                                       | Control plane API URL used by managed project resolution.                                                                          |
| `RSTREAM_ENGINE`                                        | Engine endpoint used when no engine is provided explicitly.                                                                        |
| `RSTREAM_AUTHENTICATION_TOKEN`                          | Bearer token for token-authenticated runtime connections.                                                                          |
| `RSTREAM_MTLS_CERT_FILE`                                | Client certificate file for mTLS agent authentication.                                                                             |
| `RSTREAM_MTLS_KEY_FILE`                                 | Client private key file for mTLS agent authentication.                                                                             |
| `RSTREAM_TUNNEL_TRANSPORT`                              | `auto`, `tls`, or `quic`. `auto` uses TLS; explicit `quic` fails because this runtime has no QUIC implementation.                  |
| `RSTREAM_QUIC_TRANSPORT`                                | Legacy selector. `1` requests QUIC and therefore fails in this runtime; prefer `RSTREAM_TUNNEL_TRANSPORT`.                         |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY` | Used only when `transport.proxy.fromEnvironment: true` is set. HTTP and HTTPS proxies are supported for the TLS runtime transport. |

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

## Supported runtime surface

Supported:

- control-channel TLS transport with ALPN `rstrm/1`
- HTTP CONNECT proxying for the control-channel TLS transport through `transport.proxy.http`
- HTTPS proxy verification through `transport.proxy.tls.caFile`,
  `transport.proxy.tls.serverName`, and
  `transport.proxy.tls.insecureSkipVerify`
- opt-in process proxy discovery through `transport.proxy.fromEnvironment`
- bytestream tunnel creation and close
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

The package includes a local TLS/protobuf engine harness covering:

- control-channel handshake and close
- HTTP CONNECT proxying for the control-channel TLS transport
- mTLS control-channel authentication
- bytestream tunnel create/close
- inbound proxy connection accept
- private dial
- HTTP serving
- WebSocket upgrade routing
- engine error propagation
- config precedence and auth conflict checks

Run:

```sh
npm --workspace @rstreamlabs/runtime run test
```

For a real engine integration check, start an engine first and provide the same
runtime configuration used by the CLI:

```sh
RSTREAM_ENGINE=localhost:9443 \
RSTREAM_AUTHENTICATION_TOKEN=... \
RSTREAM_RUNTIME_E2E_TLS_INSECURE=1 \
npm --workspace @rstreamlabs/runtime run test:e2e
```

For mTLS agent authentication:

```sh
RSTREAM_ENGINE=localhost:9443 \
RSTREAM_MTLS_CERT_FILE=/etc/rstream/client.pem \
RSTREAM_MTLS_KEY_FILE=/etc/rstream/client-key.pem \
RSTREAM_RUNTIME_E2E_TLS_INSECURE=1 \
npm --workspace @rstreamlabs/runtime run test:e2e
```

The real-engine E2E script verifies:

- private bytestream creation
- direct private dial by tunnel name and by tunnel ID
- bidirectional byte relay on both private streams
- published HTTP tunnel creation
- HTTPS fetch through the published forwarding URL
- WebSocket upgrade through the published forwarding URL
- mTLS agent authentication when certificate/key variables are configured
- published `mtlsAuth` rejection without a client certificate
- published `mtlsAuth` acceptance with the registered client certificate
- published `mtlsAuth` rejection when mTLS is combined with `rstream_auth`

`RSTREAM_RUNTIME_E2E_TLS_INSECURE=1` is intended for local engines using
development certificates.

## Development

```sh
npm --workspace @rstreamlabs/runtime run test
npm --workspace @rstreamlabs/runtime run test:e2e
npm --workspace @rstreamlabs/runtime run type-check
npm --workspace @rstreamlabs/runtime run lint
npm --workspace @rstreamlabs/runtime run build
```
