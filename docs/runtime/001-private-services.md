# Connect to a private service from Node.js

A private tunnel has a name or ID for an authenticated caller. The
consumer gets a Node `Duplex` and uses the same framing as the service.
Start a test HTTP service and its owner before dialing the tunnel.

## Run an origin and tunnel owner

Use the [same project or direct Engine context](../000-runtime-configuration.md)
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
[built checkout](../002-building-from-source.md):

```sh
node packages/runtime/examples/dial/src/main.ts node-private-http
```

Expect HTTP 200 followed by `hello through a private tunnel`. Pass the
tunnel ID instead of the name to reach the same service. The caller uses
a 15-second timeout for TLS setup and the HTTP exchange. It closes its
stream and client on completion.

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
