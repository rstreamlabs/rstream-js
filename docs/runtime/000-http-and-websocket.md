# Serve HTTP and WebSocket from Node.js

The runtime hands each accepted HTTP/1.1 stream to a Node `http.Server`.
Use the usual request handlers and the server's `upgrade` event. The
application can create its server without calling `listen()`; the Engine
assigns the public forwarding address. If your Node server already listens, use the
[rstream forward command](https://rstream.io/docs/getting-started/create-a-tunnel)
to publish its local port.

## Serve HTTP with the published package

Use Node.js 24 and npm. In an empty application directory, install the runtime.

```sh
npm init -y
npm install @rstreamlabs/runtime
```

With the [rstream CLI](https://rstream.io/docs/getting-started/installation) installed, sign in and approve the request in the browser.

```sh
rstream login
```

List the projects available to this identity.

```sh
rstream project list
```

If the list is empty, open the workspace in the [Dashboard](https://rstream.io/dashboard).
Workspace owners and admins can select **Create new project**. A Basic project
supports this HTTP example. Other members can ask an owner or admin for access
to an existing project. If the CLI login was limited to specific projects, run
`rstream login` again to include the intended project. Run `rstream project list`
again after gaining access.

Choose a project that allows HTTP publication. Replace `my-project-endpoint`
with its `ENDPOINT` value.

```sh
rstream project use my-project-endpoint
```

For a self-hosted Engine, use its [direct Engine context](https://rstream.io/docs/tunnels/self-hosted/deployment#agent-context).
If the Engine uses a private CA, set `NODE_EXTRA_CA_CERTS` to its CA bundle before starting Node.
The runtime reads the selected context when it connects.

Save this program as `main.mjs`.

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

Open the printed HTTPS address and expect HTTP 200 with `Hello from rstream`.
Use the [required caller credential](https://rstream.io/docs/tunnels/http-tunnels/authentication)
for a protected endpoint. For a private CA, configure the HTTP client's trust
and use the printed hostname. Stop the server with Ctrl+C.

## Run the checkout programs

Follow the [source build](../000-building-from-source.md) for the runtime
package. Use a [configured context](../001-runtime-configuration.md) that
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
node --input-type=module -e '
  const socket = new WebSocket(process.argv[1]);
  const deadline = setTimeout(() => {
    socket.close();
    process.exitCode = 1;
  }, 5000);
  socket.onmessage = ({ data }) => {
    clearTimeout(deadline);
    console.log(data);
    socket.close(1000);
  };
  socket.onerror = () => {
    clearTimeout(deadline);
    process.exitCode = 1;
  };
' 'wss://your-forwarding-host/'
```

Expect `connected through rstream`. Use an endpoint that allows the demo
caller, or configure the [required caller credential](https://rstream.io/docs/tunnels/http-tunnels/authentication).
If the Engine uses a private CA, set
`NODE_EXTRA_CA_CERTS` to its bundle before starting the caller and use
the printed hostname. Stop the server with Ctrl+C. It closes active
WebSocket sessions before releasing the tunnel.

[Own the runtime and its streams](002-lifecycle.md) for a service that
handles reconnection and graceful shutdown.
