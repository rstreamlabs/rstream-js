# Node.js tunnel and stream options

These inputs apply to `createTunnel()` in [`@rstreamlabs/runtime`](../packages/runtime/README.md).
Use [client configuration](001-runtime-configuration.md) for agent identity and the
connection to the Engine. `CreateTunnelOptions` is a runtime input; Engine
inventory JSON is a separate snake_case model with additional assigned fields.

## Creation inputs

Set `publish` deliberately. Unset optional values remain unspecified for Engine
validation and project policy. This runtime creates bytestream tunnels only;
exported protocol unions do not imply a datagram or HTTP/3 implementation.

| Option                                                           | What it controls                                                                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `labels`                                                 | Application lookup/discovery metadata. A name is not a reserved public hostname.                                                                                                                   |
| `publish`, `type`, `protocol`                                    | Published endpoint or private dialing. `type` can be omitted or `bytestream`; datagrams are rejected.                                                                                              |
| `hostname`, `port`                                               | Request a stable domain or previously reserved published TCP port. These do not perform reservation.                                                                                               |
| `httpVersion`, `upstreamTls`                                     | HTTP upstream mode. Use `http/1.1` with a Node HTTP server or `h2c` with an HTTP/2 server; explicit version and TLS upstream choices must be coherent. HTTP/3/WebTransport runtime is unsupported. |
| `tokenAuth`, `rstreamAuth`, `challengeMode`                      | Published HTTP request gates at the edge; separate from agent identity. `auth: { token, rstream, challenge }` groups the same fields.                                                              |
| `httpCors`                                                       | Explicit browser-origin policy for a published HTTP tunnel, below.                                                                                                                                 |
| `tlsMode`, `tlsMinVersion`, `tlsAlpns`, `tlsCiphers`, `mtlsAuth` | Published TLS termination/passthrough and downstream certificate policy. Passthrough leaves TLS enforcement to the application.                                                                    |
| `trustedIps`, `geoIp`                                            | Published source-address/country restrictions enforced by the Engine.                                                                                                                              |
| `allowCrossRegionRouting`                                        | Supported private-routing policy override, separate from client region selection.                                                                                                                  |

Private tunnels reject public exposure/authentication fields. A protocol may be
specified for supported private inspection; omit it for an opaque byte stream.
`id`, `creationDate`, legacy `host` and `datagramGuaranteedDelivery` are not
creation inputs. Inspect [the exported types](../packages/runtime/src/types.ts)
for the exact distinction from `TunnelProperties`.

## Stream ownership

| Operation / option                                  | Use it for                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `client.dial(nameOrId, { signal, token, zeroRtt })` | Open a private `Duplex`. A per-dial bearer token requires a client without mTLS. Set `zeroRtt: false` to wait for the handshake response when needed.                                                          |
| `tunnel.accept({ signal })`, async iteration        | Own each accepted `Duplex`; consume or destroy it explicitly.                                                                           |
| `tunnel.serve(server, { signal })` / `serveHttp`    | Feed accepted streams into a Node `http.Server` or cleartext HTTP/2 server. Existing request/upgrade handlers remain application-owned. |
| `tunnel.close()`, `control.close()`                 | Explicit admission/resource shutdown; application close differs from unexpected control loss.                                           |

Signal cancellation bounds setup/accept/serving work; use stream EOF/error for
the final payload-lifecycle result. An accepted stream may drain after unexpected
control loss. Reconnection and the HTTP server's shutdown belong to the caller.

## HTTP CORS

`createTunnel()` accepts
`httpCors: { allowedOrigins: ["https://dashboard.example"], allowedMethods: ["GET", "PUT"], allowedHeaders: ["Authorization"], exposedHeaders: ["ETag"], allowCredentials: false, maxAge: 600 }`.
Runtime inputs use camelCase; inventory JSON uses `http_cors` and snake_case.

CORS requires a published HTTP tunnel. Allowed origins must be explicit HTTP(S)
origins without paths or wildcards. Omitted method and request-header lists use
GET/HEAD/POST and Authorization/Content-Type; credentials are disabled and max
age is zero by default. An absent policy preserves upstream CORS. The Engine
answers valid preflights before request authentication, but every actual request
still needs its usual authorization. A preflight does not grant upstream access.
