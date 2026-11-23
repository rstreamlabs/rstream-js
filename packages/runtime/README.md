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

For a hosted project, use the [rstream CLI](https://rstream.io/docs/getting-started/installation)
on the development machine. Sign in with the CLI.

```sh
rstream login
```

List your projects.

```sh
rstream project list
```

Replace `my-project-endpoint` with the value from the `ENDPOINT` column.

```sh
rstream project use my-project-endpoint
```

Save this program as `main.mjs`. It reads the selected context, opens an
HTTP tunnel and serves the response with Node's built-in HTTP server.

```js
import http from "node:http";
import { Client } from "@rstreamlabs/runtime";

const client = Client.fromEnv();
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
try {
  const control = await client.connect({ signal: shutdown.signal });
  try {
    const tunnel = await control.createTunnel({
      protocol: "http",
      httpVersion: "http/1.1",
      publish: true,
    });
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("Hello from rstream");
    });
    console.log(await tunnel.forwardingAddress());
    await tunnel.serve(server, { signal: shutdown.signal });
  } finally {
    await control.close();
  }
} finally {
  process.off("SIGINT", stop);
  await client.close();
}
```

Start the server.

```sh
node main.mjs
```

Open the printed HTTPS address. On a project that allows public HTTP requests,
the response is `Hello from rstream`. Stop the server with Ctrl+C.
The [HTTP and WebSocket walkthrough](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/000-http-and-websocket.md)
shows how the same server can handle WebSocket upgrades.

## Published TCP and TLS tunnels

[Connect to a private or TCP service](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/001-private-services.md#choose-raw-tcp-publication)
covers raw addresses and port reservations. The [TLS example](https://github.com/rstreamlabs/rstream-js/blob/main/docs/runtime/001-private-services.md#publish-a-tls-service) demonstrates Engine termination and explains when to use passthrough.

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
required by its tunnel operations. For this example, leave `RSTREAM_ENGINE`
and `RSTREAM_AUTHENTICATION_TOKEN` unset.

```ts
import { Client } from "@rstreamlabs/runtime";

const client = new Client({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
  readConfigFile: false,
  noToken: false,
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

See the [tunnel options](https://github.com/rstreamlabs/rstream-js/blob/main/docs/002-tunnel-options.md)
for supported creation properties, including TLS termination and passthrough.
Unsupported inputs return a `RuntimeError.code` during configuration or creation.

## Certificate-authenticated Engine HTTP methods

Call `await client.getEngineAPI()` to use the Engine SDK for inventory or SSE
watching with the runtime's resolved file-based mTLS identity. The runtime
owns the returned Engine client. The dedicated API authority is discovered anonymously
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
