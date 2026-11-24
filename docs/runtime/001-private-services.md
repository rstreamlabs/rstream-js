# Connect to private services and publish TCP or TLS

A private tunnel has a name or ID for an authenticated caller. The
consumer gets a Node `Duplex` and uses the same framing as the service.
Start a test HTTP service and its owner before dialing the tunnel.

## Run an origin and tunnel owner

Use the [same project or direct Engine context](../001-runtime-configuration.md)
on the owning and dialing sides. The owner must be able to create a
private tunnel and the caller must be allowed to dial it. Using Python 3
on macOS or Linux, serve a single file on loopback:

```sh
demo_dir=$(mktemp -d)
printf 'hello through a private tunnel\n' > "$demo_dir/index.html"
python3 -m http.server 8000 --bind 127.0.0.1 --directory "$demo_dir"
```

In a separate terminal, expose it privately with the CLI:

```sh
rstream forward 127.0.0.1:8000 --no-publish --name node-private-http
```

Wait for the tunnel to come online. From the root of the
[built checkout](../000-building-from-source.md):

```sh
node packages/runtime/examples/dial/src/main.ts node-private-http
```

Expect HTTP 200 followed by `hello through a private tunnel`. Pass the
tunnel ID instead of the name to reach the same service. The caller uses
a 15-second timeout for TLS setup and the HTTP exchange. It closes its
stream and client on completion. Stop the CLI forwarder and Python server
with Ctrl+C. Remove `"$demo_dir"` from the shell where you started Python.

To own the listener in Node.js, use `ctrl.createTunnel({ publish: false,
name: "node-private-http" })` and accept the streams. Each handler must
close the duplex it receives. To relay to an existing server instead, let
the CLI keep the local service and tunnel lifetimes independent.

## Choose raw TCP publication

Use `publish: true` and `protocol: "tcp"` when a standard TCP caller needs
a public host and port. Omit `port` for an ephemeral address or pass an
existing reservation. The application protocol provides caller authentication
and encryption, as SSH does. See [TCP tunnels](https://rstream.io/docs/tunnels/tcp-tunnels)
for supported deployments and policy.

## Publish a TLS service

Use an Engine and project that allow published TLS. To terminate TLS at
the Engine, use these creation options in the
[published HTTP example](000-http-and-websocket.md#serve-http-with-the-published-package).

```js
const tunnel = await control.createTunnel({
  publish: true,
  protocol: "tls",
  tlsMode: "terminated",
});
```

The Engine presents the certificate for the printed hostname. The Node
server receives a clear byte stream, so the example's plain HTTP handler
can still answer an HTTPS request. Use curl with the printed hostname and
port, omitting the `(tls)` label.

```sh
curl -fsS --http1.1 'https://your-forwarding-host:443/'
```

Pass `--cacert /path/to/engine-ca.pem` for an Engine using a private certificate
authority. Expect `Hello from rstream`. Stop with Ctrl+C.

Choose `tlsMode: "passthrough"` when your application owns the TLS
handshake and presents the public certificate. Handle accepted streams
with your TLS server. For HTTP routing and request-level authorization at
the Engine, use an HTTP tunnel.
