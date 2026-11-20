# Serve HTTP and WebSocket from Node.js

The runtime hands each accepted HTTP/1.1 stream to a Node `http.Server`.
Use the usual request handlers and the server's `upgrade` event. The
application can create its server without calling `listen()`; the Engine
assigns the public forwarding address. If your Node server already listens, use the
[rstream forward command](https://rstream.io/docs/getting-started/create-a-tunnel)
to publish its local port.

## Run the checkout programs

Follow the [source build](../002-building-from-source.md) for the runtime
package. Use a [configured context](../000-runtime-configuration.md) that
allows published HTTP. The example code uses Node.js 24 and imports
the packages built by the workspace.

```sh
node packages/runtime/examples/http-server/src/main.ts
```

Wait for `Server accessible at:` and open that HTTPS URL. Expect HTTP 200
with the hostname of the Node process. Use the required
[caller credential](https://rstream.io/docs/tunnels/http-tunnels/authentication)
for a protected endpoint. Stop the process with Ctrl+C.

## Open a WebSocket

The [WebSocket program](../../packages/runtime/examples/websocket/src/main.ts)
attaches `ws` to the Node HTTP server's upgrade handler. The root
workspace install provides `ws` for this run.

```sh
node packages/runtime/examples/websocket/src/main.ts
```

For a standalone application, install both packages with
`npm install @rstreamlabs/runtime ws`. Wait for `WebSocket address:`.
Pass that `wss://` URL to Node's WebSocket client from another terminal,
replacing the example value.

```sh
node -e 'const ws = new WebSocket(process.argv[1]); ws.onmessage = ({data}) => { console.log(data); ws.close(1000); }; ws.onerror = () => { process.exitCode = 1; };' 'wss://your-forwarding-host/'
```

Expect `connected through rstream`. This caller requires a project that
allows it to connect. If the Engine uses a private CA, set
`NODE_EXTRA_CA_CERTS` to its bundle before starting the caller and use
the printed hostname. Stop the server with Ctrl+C. It closes active
WebSocket sessions before releasing the tunnel.

[Own the runtime and its streams](002-lifecycle.md) for a service that
handles reconnection and graceful shutdown.
