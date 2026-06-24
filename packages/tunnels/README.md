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
lifetime, explicit read-only watch permissions, and list-only tunnel resources.

Browser integrations should provide `auth` as a function that calls a backend
token route and returns a fresh watch token for each connection attempt. Do not
store the `rstream.token` query token as durable browser state.

## Scoped Auth Tokens

`auth.createAuthToken()` mints short-lived engine tokens. Prefer
`resources.tunnels` when delegating capabilities to devices, browser sessions,
or other services.

```ts
const { token } = await client.auth.createAuthToken({
  expires_in: 60,
  resources: {
    tunnels: {
      scopes: {
        tunnels: {
          list: { select: { id: true, name: true, protocol: true } },
          connect: { params: { path: { regex: "^/api" } } },
        },
      },
    },
  },
});
```

When the client is configured with `projectEndpoint` or `projectId`, scope-only
tunnel resources are project-scoped by default. Pass `projectScoped: false`
only when a global scope-only tunnel resource is intentional.

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
  ttlSeconds: 600,
});
```

TURN credentials are short-lived. `ttlSeconds` is optional, defaults to 600 for
local derivation, and must be an integer between 1 and 3600 seconds. PAT-backed
credentials are additionally capped by the PAT expiration.

## Webhooks

Validate signed webhook payloads with constant-time signature comparison and
schema parsing. Webhook parsing accepts lifecycle events only; stream summaries
and connection logs use the separate project log event schema.

```ts
const event = await client.webhooks.event(
  rawBody,
  request.headers.get("rstream-signature")!,
  process.env.WEBHOOK_SECRET!,
);

console.log(event.type);
```

For a receiving backend, verify the signature before touching the JSON payload
and use the event id as the idempotency key.

```ts
import { RstreamWebhookResource } from "@rstreamlabs/tunnels";
import { type WebhookEvent } from "@rstreamlabs/tunnels";

const webhooks = new RstreamWebhookResource();

declare function markOnline(
  eventId: string,
  resourceId: string,
  labels: Record<string, string>,
): Promise<void>;

declare function markOffline(
  eventId: string,
  resourceId: string,
  labels: Record<string, string>,
): Promise<void>;

async function handleLifecycleEvent(
  event: WebhookEvent & { id: string },
): Promise<void> {
  switch (event.type) {
    case "client.created":
    case "tunnel.created":
      await markOnline(event.id, event.object.id, event.object.labels ?? {});
      return;
    case "client.deleted":
    case "tunnel.deleted":
      await markOffline(event.id, event.object.id, event.object.labels ?? {});
      return;
  }
}

export async function receiveWebhook(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("rstream-signature");
  if (!signature) throw new Error("Missing webhook signature.");
  const event = await webhooks.event(
    rawBody,
    signature,
    process.env.WEBHOOK_SECRET!,
  );
  if (!event.id) throw new Error("Missing webhook event id.");
  await handleLifecycleEvent(event);
}
```

## Project Log Events

Use `streamSummarySchema` for connection log entries returned by the Engine API.
The `request.entry.kind` field distinguishes published access from private
rstream dials; `formatStreamAccessPath` returns the dashboard-safe label for
that value.

```ts
import { formatStreamAccessPath } from "@rstreamlabs/tunnels";
import { streamSummarySchema } from "@rstreamlabs/tunnels";

const summary = streamSummarySchema.parse(payload);

console.log(formatStreamAccessPath(summary.request.entry));
```

For local receiver tests, the SDK exposes the same signing primitives used by
the CLI and Engine dispatcher:

```ts
import { buildWebhookHeaders } from "@rstreamlabs/tunnels";
import { generateWebhookSigningSecret } from "@rstreamlabs/tunnels";
import { type WebhookEvent } from "@rstreamlabs/tunnels";

const secret = generateWebhookSigningSecret();
const event: WebhookEvent & { id: string } = {
  id: "evt_test",
  type: "tunnel.created",
  created_at: new Date().toISOString(),
  object: {
    id: "tunnel_test",
    labels: {
      device: "device_123",
    },
  },
};
const body = JSON.stringify(event);
const headers = buildWebhookHeaders(body, event, secret, {
  deliveryId: "del_test",
  webhookId: "we_test",
});

await fetch("http://localhost:3000/api/rstream/webhook", {
  body,
  headers: {
    "content-type": "application/json",
    ...headers,
  },
  method: "POST",
});
```

`rstream events --webhook` uses the same request body and header contract when
forwarding live local events to a receiver.

## WebTTY Helpers

Use `parseWebTTYServers()` to derive WebTTY server metadata from tunnel
inventory.

```ts
import { parseWebTTYServers } from "@rstreamlabs/tunnels";

const servers = parseWebTTYServers(await client.tunnels.list());
```

WebTTY server metadata includes advertised capabilities such as `exec` and
`fs`. Older servers that do not advertise capabilities are treated as
`exec`-only with the execution path `/`.

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
