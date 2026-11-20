# Node runtime development

## Tests

The package includes a local TLS/protobuf engine harness covering:

- control-channel handshake and close
- negotiated heartbeat recovery, timeout, and established-stream draining
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
