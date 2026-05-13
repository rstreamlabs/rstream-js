# `@rstreamlabs/rstream`

Managed Control plane SDK for rstream JavaScript and TypeScript integrations.

Use this package when code needs to call the hosted rstream API at
`https://rstream.io`: account context, managed tunnel project discovery, project
endpoint resolution, and managed TURN credential issuance. It does not open the
tunnel runtime protocol itself.

For Engine HTTP API operations, use
[`@rstreamlabs/tunnels`](../tunnels/README.md). For Node.js tunnel creation and
private dialing, use [`@rstreamlabs/runtime`](../runtime/README.md).

## Install

```sh
npm install @rstreamlabs/rstream
```

## Authentication

The client accepts either a bearer token or application credentials.

```ts
import { RstreamClient } from "@rstreamlabs/rstream";

const client = new RstreamClient({
  credentials: { token: process.env.RSTREAM_AUTHENTICATION_TOKEN! },
});
```

Application credentials are signed locally into a short-lived app token before
the Control plane request is sent:

```ts
import { RstreamClient } from "@rstreamlabs/rstream";

const client = new RstreamClient({
  credentials: {
    clientId: process.env.RSTREAM_CLIENT_ID!,
    clientSecret: process.env.RSTREAM_CLIENT_SECRET!,
  },
});
```

If credentials are not passed explicitly, the client reads
`RSTREAM_AUTHENTICATION_TOKEN` from the process environment. `RSTREAM_API_URL`
can override the default hosted API URL.

## Account Context

```ts
const whoami = await client.whoami();

console.log(whoami.id);
console.log(whoami.email);
```

`whoami()` returns the authenticated user context for the configured token or
application credentials.

## Managed Tunnel Projects

List managed tunnel projects:

```ts
const projects = await client.tunnels.projects.list({
  pageSize: 20,
  q: "prod",
});

for (const project of projects.projects) {
  console.log(project.endpoint, project.plan);
}
```

Resolve a project endpoint when an integration stores stable project slugs
instead of internal IDs:

```ts
const project =
  await client.tunnels.projects.resolveByEndpoint("project-endpoint");

console.log(project.id);
console.log(project.url);
```

## Managed TURN Credentials

Managed TURN issuance is exposed through the Control plane API.

```ts
const turn =
  await client.tunnels.projects.createTurnCredentialsByEndpoint(
    "project-endpoint",
  );

console.log(turn.urls);
```

Use [`@rstreamlabs/tunnels`](../tunnels/README.md) when you need local TURN
derivation from PAT or application credentials without calling the issuance
endpoint.

## Low-Level Requests

For routes that are available on the hosted API but not wrapped yet, use
`request()` with a relative absolute API path:

```ts
const payload = await client.request<unknown>("/api/whoami", {
  method: "GET",
});
```

The client prevents absolute or cross-origin request paths from being used
accidentally.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `RSTREAM_API_URL` | Control plane API URL. Defaults to `https://rstream.io`. |
| `RSTREAM_AUTHENTICATION_TOKEN` | Bearer token used when credentials are not provided explicitly. |

Application credentials should normally be passed explicitly from backend
configuration rather than read from ambient process state.

## Development

```sh
npm --workspace @rstreamlabs/rstream run type-check
npm --workspace @rstreamlabs/rstream run lint
npm --workspace @rstreamlabs/rstream run build
```
