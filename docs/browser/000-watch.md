# Watch live Engine state

A backend can query the Engine using its authorized credentials. For an
interactive view, issue a short-lived watch token restricted to the
project, resources and fields that the viewer needs. Agent and account
credentials stay with the backend.

## Inspect a watch from Node.js

Install `@rstreamlabs/tunnels`. Use Node.js 24 and the built-in
WebSocket client. For a managed project, provision application credentials
with `account.projects.read-only` to resolve the supplied project endpoint
and `tunnels.resources.read-only` for the watch. The short-lived watch
token includes only the Engine permission. In a
shell with `RSTREAM_CLIENT_ID`, `RSTREAM_CLIENT_SECRET` and
`RSTREAM_PROJECT_ENDPOINT` set, save this program as `watch.mjs`.

```js
import { RstreamTunnelsClient, Watch } from "@rstreamlabs/tunnels";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error("Missing " + name);
  return value;
}

const client = new RstreamTunnelsClient({
  credentials: {
    clientId: required("RSTREAM_CLIENT_ID"),
    clientSecret: required("RSTREAM_CLIENT_SECRET"),
  },
  projectEndpoint: required("RSTREAM_PROJECT_ENDPOINT"),
});

try {
  const engine = await client.getEngine();
  const { token } = await client.auth.createAuthToken({
    expires_in: 60,
    permissions: ["tunnels.resources.read-only"],
    resources: {
      tunnels: {
        scopes: {
          clients: { list: false },
          tunnels: { list: { select: { id: true, name: true, status: true } } },
        },
      },
    },
  });
  const watch = new Watch(
    { engine, auth: token, transport: "websocket" },
    { onEvent: (event) => console.log(event.type, event.object) },
  );
  const close = () => watch.disconnect();
  process.once("SIGINT", close);
  const deadline = setTimeout(close, 60_000);
  try {
    await watch.connect();
  } catch (error) {
    close();
    throw error;
  } finally {
    deadline.unref();
  }
} finally {
  await client.close();
}
```

Use a managed deployment that supports client-list scopes. Run `node watch.mjs`. Expect `state.initial` with the visible tunnel
fields. Start or stop a tunnel you can list to see the corresponding
event. Ctrl+C disconnects the watch. The program establishes one
subscription. A durable service should create a new watch with fresh
credentials after disconnection and apply bounded backoff.

The watch token is valid for the one project. Use the backend client
certificate with [certificate-only Engine access](../../packages/tunnels/README.md#certificate-only-engine-access)
when that deployment has been configured for mTLS. The certificate SSE
path can use the existing Node HTTP client.

## Connect a browser

Follow [Browser clients](https://rstream.io/docs/integrations/browser-clients)
for the backend token route and the browser connection. Token SSE needs
the browser's `EventSource`. In Node.js use the WebSocket path above
for token watches. Use the [React hooks](../../packages/react/README.md)
when a React application needs subscription ownership and reconnection.

Each `state.initial` event replaces the current snapshot, including
snapshots sent during an existing connection. Apply subsequent events.
If a list scope projects out IDs, use replacement snapshots and avoid
keying actionable rows by a missing identifier. Request a new snapshot
after reconnecting.

A watch credential authorizes the selected inventory. Opening a terminal
or an HTTP stream needs a separate credential scoped to its target. See
[WebTTY browser usage](https://rstream.io/docs/webtty/sdk-browser) for
the connection handshake and its own authorization.
