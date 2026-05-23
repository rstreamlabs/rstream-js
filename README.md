<!-- See LICENSE file in the project root for license information. -->

# `rstream-js`

Official JS/TS SDKs for rstream.

This repository is split into focused packages:

- `@rstreamlabs/rstream`: Control plane API and shared types
- `@rstreamlabs/tunnels`: Engine API and tunnel runtime APIs, for both managed and self-hosted deployments
- `@rstreamlabs/react`: React hooks and components on top of `@rstreamlabs/tunnels`
- `@rstreamlabs/utils/file-sharing`: browser-side helpers for the hosted file-sharing tool protocol

## Install

```bash
npm install @rstreamlabs/rstream @rstreamlabs/tunnels
```

## Control plane API

Use `@rstreamlabs/rstream` for account-level and project-level APIs exposed by `https://rstream.io`.

```ts
import { RstreamClient } from "@rstreamlabs/rstream";

const client = new RstreamClient({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
});

const whoami = await client.whoami();
const projects = await client.tunnels.projects.list();
const project =
  await client.tunnels.projects.resolveByEndpoint("project-endpoint");
const turn = await client.tunnels.projects.createTurnCredentials(project.id);
```

The Control plane API client also supports application credentials directly:

```ts
import { RstreamClient } from "@rstreamlabs/rstream";

const client = new RstreamClient({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
});

const whoami = await client.whoami();
const projects = await client.tunnels.projects.list();
```

## Engine API and tunnel runtime

Use `@rstreamlabs/tunnels` to talk directly to a tunnels engine. This works with managed projects resolved through the Control plane API, and with self-hosted engines.

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const client = new RstreamTunnelsClient({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
  engine: process.env.RSTREAM_ENGINE!,
});

const tunnels = await client.tunnels.list();
const clients = await client.clients.list();
```

## Application Credentials

For backend integrations, `@rstreamlabs/tunnels` also supports application credentials directly.
When `projectEndpoint` is configured, engine tokens minted by the SDK are
restricted to the resolved managed project. When connecting to an explicit
engine with application credentials, provide `projectId` or `workspaceId` so
locally signed engine tokens are not global.

```ts
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";

const client = new RstreamTunnelsClient({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
  projectEndpoint: "project-endpoint",
});

const engine = await client.getEngine();
const tunnels = await client.tunnels.list();
```

## Fine-Grained Tokens

A typical backend flow is to mint a short-lived token with narrow permissions,
then distribute that token to an untrusted client. Use `resources.tunnels` with
explicit `projects` or `workspaces`. When the client is configured with
`projectEndpoint` or `projectId`, scope-only tunnel resources are
project-scoped by default; pass `projectScoped: false` only when you
intentionally need a global scope-only tunnel resource.

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
  resources: {
    tunnels: {
      projects: ["project-id"],
      scopes: {
        tunnels: {
          create: { filters: { protocol: { oneof: ["http"] } } },
          connect: { params: { path: { regex: "^/api" } } },
          list: { select: { id: true, name: true, protocol: true } },
        },
      },
    },
  },
});
```

## TURN Credentials

`@rstreamlabs/tunnels` supports the three TURN credential flows used by the platform:

- managed API issuance with a short-lived auth token
- local PAT-based derivation from a PAT
- local app-based derivation

```ts
import { createTURNCredentials } from "@rstreamlabs/tunnels";

const turn = await createTURNCredentials({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
  projectEndpoint: "project-endpoint",
  ttlSeconds: 600,
});
```

TURN credential TTLs must be between 1 and 3600 seconds. Local derivation
defaults to 600 seconds.
