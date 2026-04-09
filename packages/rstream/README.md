# `@rstreamlabs/rstream`

Control-plane and shared JS/TS SDK for managed rstream APIs.

Use this package for account-level and project-level APIs exposed by rstream,
such as `whoami`, managed tunnels project discovery, and managed TURN
credential issuance.

This package supports:

- bearer tokens
- application `clientId` / `clientSecret` pairs

When application credentials are used, the SDK signs a short-lived app token
locally before calling the control-plane API. For managed TURN credential
issuance, the control-plane endpoint still expects that short-lived auth token.

## Usage

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

Application credentials work as well:

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

`@rstreamlabs/rstream` reads `RSTREAM_API_URL` and
`RSTREAM_AUTHENTICATION_TOKEN` when they are not provided explicitly.

For engine and data-plane APIs, use [`@rstreamlabs/tunnels`](../tunnels/README.md).
