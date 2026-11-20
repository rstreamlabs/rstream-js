# Configure the Node.js runtime

Use this reference after [serving the first HTTP application](../packages/runtime/README.md#http-tunnel-server).
It applies to `@rstreamlabs/runtime` in Node, not to a browser or to the separate
Control plane client. The runtime uses TLS and bytestreams; unsupported transport
and credential-store settings fail explicitly.

## Select an identity and destination

Explicit client options override environment values, then the selected shared
CLI context and defaults. `Client.fromEnv(options)` and `new Client(options)`
use the same resolution. `readConfigFile: false` disables YAML loading without
disabling environment or explicit validation.

For a developer workstation, run `rstream login` and `rstream project use
<endpoint>` once and reuse that context. A service should instead receive its own
project-scoped identity. Do not copy a personal login context into a deployment.
Token credentials and a certificate identity are mutually exclusive. An explicit
Engine override cannot reuse stored credentials for a different destination.

```js
import { Client } from "@rstreamlabs/runtime";

const client = new Client({
  engine: "project-engine.example:443",
  token: process.env.RSTREAM_AUTHENTICATION_TOKEN,
  readConfigFile: false,
  requireToken: true,
});
```

Entering a service loop should own this client and each control/tunnel it opens.
`client.close()` releases owned HTTP pools; close native controls and tunnels
separately. There is no automatic tunnel recreation in the low-level runtime.
Supervise reconnects outside request handlers with bounded backoff, retain a
requested stable hostname, and stop the loop on application shutdown. Do not
replay a request merely because a connection was lost. The [Next.js sample](https://github.com/rstreamlabs/rstream-examples/tree/main/nextjs-rstream-preview)
shows an application-owned supervisor.

Handle creation and close rejections during shutdown: a lost control channel
rejects pending operations even when the application initiated the shutdown.

## Client options

| Option                                          | Default / purpose                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `configPath`, `context`, `readConfigFile`       | `~/.rstream/config.yaml`, selected context, `true`; choose or disable shared YAML loading.                                                                                           |
| `engine`, `projectEndpoint`, `apiUrl`, `region` | Direct Engine host/port or managed project discovery. Region needs managed metadata and cannot accompany an explicit Engine.                                                         |
| `token`, `credentials`                          | Explicit token or application credentials. APP credentials are backend-only and sign scoped tokens; use the managed `projectEndpoint` path to resolve their project scope.           |
| `noToken` | Set to `true` to omit token authentication on native connections. The default uses configured credentials when available. |
| `requireToken` | Set to `true` to reject configuration without a bearer token, application credentials, or a client certificate. |
| `controlPlaneHeaders`                           | Additional validated headers for a deployment access layer; authentication and hop-by-hop headers remain reserved.                                                                   |
| `tls`                                           | Verified system trust by default. Node TLS options `ca`, `cert`, `key`, `servername`, `rejectUnauthorized`, `checkServerIdentity`; preserve verification outside synthetic fixtures. |
| `tunnelTransport`                               | `auto` selects TLS; `tls` pins it and `quic` fails as unsupported.                                                                                                                   |
| `heartbeat`, `heartbeatIntervalMs`              | `true`, 5000 ms; enabled intervals must be integers between 1000 and 300000 ms. Protects control admission, not the payload's lifetime.                                              |
| `zeroRtt`                                       | `true`; rstream stream-handshake optimization, not TLS early data. A dial may override it.                                                                                           |
| `transport`, `logger`                           | Explicit transport/logging adapters for an embedder; do not assume a custom adapter adds protocol capabilities.                                                                      |

The public [ClientOptions](../packages/runtime/src/config.ts) and
[stream/tunnel types](../packages/runtime/src/types.ts) define exact signatures.
`connect`, `dial`, `accept` and HTTP serving accept `AbortSignal` options;
stream payload deadlines and application shutdown remain the caller's policy.

## Process environment

| Variables                                            | Purpose                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `RSTREAM_CONFIG`, `RSTREAM_CONTEXT`                  | Shared config path and selected context.                                                 |
| `RSTREAM_ENGINE`                                     | Engine authority, without URL scheme/path.                                               |
| `RSTREAM_AUTHENTICATION_TOKEN`                       | Explicit runtime token. Not a browser session token route.                               |
| `RSTREAM_MTLS_CERT_FILE`, `RSTREAM_MTLS_KEY_FILE`    | Paired enrolled agent identity files. Do not set a token at the same time.               |
| `RSTREAM_API_URL`, `RSTREAM_REGION`                  | Managed Control plane discovery and authorized region selection.                         |
| `RSTREAM_CONTROL_PLANE_HEADERS`                      | JSON object of deployment-access headers.                                                |
| `RSTREAM_TUNNEL_TRANSPORT`, `RSTREAM_QUIC_TRANSPORT` | Canonical selector (`auto`/`tls`/`quic`) and legacy selector. Explicit QUIC is rejected. |
| `NODE_EXTRA_CA_CERTS`                                | Node startup trust bundle for a private CA; set before launching Node.                   |
| `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY` | Process proxy discovery only when `transport.proxy.fromEnvironment` is enabled.          |

Shared YAML also supports `transport.ipFamily: ipv4|ipv6` and
`transport.bind` with an explicit address, or `mode: interface` plus an interface
name. Node chooses a usable local interface address; these settings constrain
outbound dialing, not tunnel publication. Enabling `transport.mptcp` is rejected.

Shared YAML may configure an HTTP/HTTPS CONNECT proxy, credentials/headers, and
separate proxy TLS `caFile`, `serverName`, `insecureSkipVerify` settings. Proxy
TLS covers only that hop; Engine TLS is still verified inside CONNECT. This
runtime does not read desktop proxy preferences, implement SOCKS5/custom DNS,
or execute an `auth.mtls.storage.kind: exec` helper. Use the Go SDK/CLI for
those capabilities rather than silently changing identity or transport.

## Separate API and browser clients

`@rstreamlabs/rstream` accepts explicit Control plane credentials and does not
load the CLI context. `@rstreamlabs/tunnels` accepts explicit Engine/project
configuration, inventory/watch scopes and optional Node certificate access.
Their package guides describe those distinct options and the API URL/header
environment. Browser hooks and terminal/filesystem clients receive explicit
session configuration from the application backend; they never discover local
credentials from `.rstream` or process environment variables.
