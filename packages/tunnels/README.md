# `@rstreamlabs/tunnels`

Engine API JS/TS SDK for rstream tunnels.

Use this package to talk directly to the tunnels engine: list tunnels, inspect
clients, watch engine events, validate webhooks, and create fine-grained app
tokens.

The package supports both:

- direct engine usage, including self-hosted deployments
- managed rstream projects resolved via the Control plane API
- bearer-token authentication and application credentials

## Self-hosted usage

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const client = new RstreamTunnelsClient({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
  engine: process.env.RSTREAM_ENGINE!,
});

const tunnels = await client.tunnels.list();
```

## Managed usage

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const client = new RstreamTunnelsClient({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
  projectEndpoint: "project-endpoint",
});

const engine = await client.getEngine();
const turn = await client.turn.createCredentials();
```

## Application Credentials

`@rstreamlabs/tunnels` can work directly with an app `clientId` and
`clientSecret`. This is the intended backend flow when you want the server to
mint short-lived tokens for downstream clients.

Managed `projectEndpoint` clients mint engine tokens restricted to the resolved
project. Explicit `engine` clients using application credentials must provide
`projectId` or `workspaceId` so locally signed engine tokens are not global.

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const client = new RstreamTunnelsClient({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
});

const tunnels = await client.tunnels.list();
```

## Fine-Grained Tokens

Prefer `tunnelsGrants` with explicit operation scopes. When the client is
configured with `projectEndpoint` or `projectId`, scope-only requests and
scope-only grant leaves are project-scoped by default. Pass
`projectScoped: false` only when you intentionally need a global scope-only
grant.

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const admin = new RstreamTunnelsClient({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
});

const { token } = await admin.auth.createAuthToken({
  expires_in: 60,
  tunnelsGrants: {
    scopes: {
      tunnels: {
        create: { filters: { protocol: { oneof: ["http"] } } },
        connect: { params: { path: { regex: "^/api" } } },
        list: { select: { id: true, name: true, protocol: true } },
      },
    },
  },
});
```

## TURN credentials

`@rstreamlabs/tunnels` supports the same three TURN credential paths as the
platform:

- managed API issuance with a short-lived auth token
- local derivation from a PAT
- local derivation from an app `clientId` and `clientSecret`

```ts
import { createTURNCredentials } from "@rstreamlabs/tunnels";

const turn = await createTURNCredentials({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
  projectEndpoint: "project-endpoint",
});
```

`@rstreamlabs/tunnels` reads `RSTREAM_API_URL`, `RSTREAM_ENGINE`, and
`RSTREAM_AUTHENTICATION_TOKEN` when they are not provided explicitly.

For the Control plane API, use [`@rstreamlabs/rstream`](../rstream/README.md).
