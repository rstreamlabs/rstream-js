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

For a real Engine check, start a test Engine and use an identity that can
create published HTTP and private bytestream tunnels. Set `RSTREAM_ENGINE` to
its hostname and port. For a private CA, set `NODE_EXTRA_CA_CERTS` to the CA
bundle before starting Node.

With a runtime token supplied in `RSTREAM_AUTHENTICATION_TOKEN`, run:

```sh
npm --workspace @rstreamlabs/runtime run test:e2e
```

For mTLS agent authentication, use an enrolled client certificate and key
in a shell with `RSTREAM_AUTHENTICATION_TOKEN` unset.

```sh
RSTREAM_MTLS_CERT_FILE=/etc/rstream/client.pem \
RSTREAM_MTLS_KEY_FILE=/etc/rstream/client-key.pem \
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

The HTTPS and WebSocket test clients skip verification of the published
endpoint certificate. Use a disposable Engine for this fixture. The runtime
client verifies the Engine certificate by default.

## Development

```sh
npm --workspace @rstreamlabs/runtime run type-check
npm --workspace @rstreamlabs/runtime run lint
npm --workspace @rstreamlabs/runtime run build
```
