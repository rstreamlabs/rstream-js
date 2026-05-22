# `@rstreamlabs/tunnels`

Engine HTTP API SDK for rstream tunnels.

Use this package when code needs operational tunnel state rather than the
runtime tunnel protocol itself: list clients and tunnels, watch engine events,
validate webhooks, mint scoped tunnel tokens, derive TURN credentials, and work
with WebTTY tunnel metadata.

For hosted Control plane operations, use
[`@rstreamlabs/rstream`](../rstream/README.md). For creating and serving
bytestream tunnels from Node.js, use
[`@rstreamlabs/runtime`](../runtime/README.md).

## Install

```sh
npm install @rstreamlabs/tunnels
```

## Client Setup

Connect directly to a known engine, which is the common self-hosted shape:

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const client = new RstreamTunnelsClient({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
  engine: process.env.RSTREAM_ENGINE!,
});

const tunnels = await client.tunnels.list();
const clients = await client.clients.list();
```

For hosted projects, provide `projectEndpoint` and let the SDK resolve the
engine through the Control plane API:

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const client = new RstreamTunnelsClient({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
  projectEndpoint: "project-endpoint",
});

const engine = await client.getEngine();
const tunnels = await client.tunnels.list();
```

Application credentials are supported for backend integrations that should mint
short-lived engine tokens on demand:

```ts
const client = new RstreamTunnelsClient({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
});

const tunnels = await client.tunnels.list();
```

When application credentials are used with an explicit `engine`, also provide
`projectId` or `workspaceId` so locally signed engine tokens are scoped.

## Tunnel and Client Inventory

```ts
const tunnels = await client.tunnels.list({
  filters: {
    labels: {
      env: "prod",
    },
  },
});

const clients = await client.clients.list();
```

Schemas and TypeScript types are exported for clients, tunnels, stream
summaries, and engine events.

## Watch Streams

`Watch` subscribes to engine events over SSE or WebSocket and validates each
event payload.

```ts
import { Watch } from "@rstreamlabs/tunnels";

const watch = new Watch(
  {
    auth: process.env.RSTREAM_AUTHENTICATION_TOKEN!,
    engine: process.env.RSTREAM_ENGINE!,
    transport: "sse",
  },
  {
    onEvent: (event) => {
      console.log(event.type);
    },
    onClose: () => {
      console.log("watch closed");
    },
  },
);

await watch.connect();
```

URL-based watch authentication requires a short-lived token with bounded
lifetime and watch-only tunnel list grants.

## Scoped Auth Tokens

`auth.createAuthToken()` mints short-lived engine tokens. Prefer
`tunnelsGrants` when delegating capabilities to devices, browser sessions, or
other services.

```ts
const { token } = await client.auth.createAuthToken({
  expires_in: 60,
  tunnelsGrants: {
    scopes: {
      tunnels: {
        list: { select: { id: true, name: true, protocol: true } },
        connect: { params: { path: { regex: "^/api" } } },
      },
    },
  },
});
```

When the client is configured with `projectEndpoint` or `projectId`, scope-only
requests and scope-only grant leaves are project-scoped by default. Pass
`projectScoped: false` only when a global scope-only grant is intentional.

## TURN Credentials

The package supports the same TURN credential paths as the platform:

- managed API issuance with a short-lived auth token
- local derivation from a personal access token
- local derivation from application credentials

```ts
import { createTURNCredentials } from "@rstreamlabs/tunnels";

const turn = await createTURNCredentials({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
  clusterDomain: "cluster.example.rstream.test",
});
```

## Webhooks

Validate signed engine webhook payloads with constant-time signature comparison
and schema parsing:

```ts
const event = await client.webhooks.event(
  rawBody,
  request.headers.get("rstream-signature")!,
  process.env.WEBHOOK_SECRET!,
);

console.log(event.type);
```

## WebTTY Helpers

Use `parseWebTTYServers()` to derive WebTTY server metadata from tunnel
inventory.

```ts
import { parseWebTTYServers } from "@rstreamlabs/tunnels";

const servers = parseWebTTYServers(await client.tunnels.list());
```

## OpenAPI Document

The package exports the Engine API OpenAPI document from the main entrypoint
and from the `@rstreamlabs/tunnels/openapi` subpath.

```ts
import { engineOpenApiDocument } from "@rstreamlabs/tunnels/openapi";

console.log(engineOpenApiDocument.info.title);
```

## Environment Variables

| Variable                       | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `RSTREAM_API_URL`              | Control plane API URL used for managed project resolution.      |
| `RSTREAM_ENGINE`               | Engine endpoint used when no engine is provided explicitly.     |
| `RSTREAM_AUTHENTICATION_TOKEN` | Bearer token used when credentials are not provided explicitly. |

## Development

```sh
npm --workspace @rstreamlabs/tunnels run test
npm --workspace @rstreamlabs/tunnels run type-check
npm --workspace @rstreamlabs/tunnels run lint
npm --workspace @rstreamlabs/tunnels run build
```
