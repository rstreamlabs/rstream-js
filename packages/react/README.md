# `@rstreamlabs/react`

React hooks, providers, and terminal components for rstream-enabled UIs.

Use this package in browser applications and dashboards that need live tunnel
state or embedded WebTTY sessions. It builds on
[`@rstreamlabs/tunnels`](../tunnels/README.md) for watch streams and
[`@rstreamlabs/webtty`](../webtty/README.md) for the browser-side WebTTY
protocol.

## Install

```sh
npm install @rstreamlabs/react
```

The package has a peer dependency on React 18 or 19.

## Exports

| Import path                     | Contents                                |
| ------------------------------- | --------------------------------------- |
| `@rstreamlabs/react`            | Hooks, providers, and components.       |
| `@rstreamlabs/react/hooks`      | `useRstream`.                           |
| `@rstreamlabs/react/providers`  | `RstreamProvider`, `useRstreamContext`. |
| `@rstreamlabs/react/components` | `WebTTYTerminal`.                       |

## Live Tunnel State

`useRstream()` wraps the engine watch stream and keeps tunnel/client arrays in
React state.

```tsx
"use client";

import { useRstream } from "@rstreamlabs/react/hooks";

async function createWatchToken() {
  const response = await fetch("/api/rstream/watch-token", {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to create watch token.");
  }
  const { token } = await response.json();
  return token;
}

export function TunnelInventory() {
  const { state, error, tunnels } = useRstream({
    auth: createWatchToken,
    engine: "project-endpoint.cluster.example.rstream.test:443",
    transport: "sse",
  });

  if (error) return <p>{error.message}</p>;
  return (
    <ul data-state={state}>
      {tunnels
        .filter((tunnel) => tunnel.id !== undefined)
        .map((tunnel) => (
          <li key={tunnel.id}>{tunnel.name ?? tunnel.id}</li>
        ))}
    </ul>
  );
}
```

The hook reconnects automatically and clears state when authentication is not
configured.

The returned arrays use `ListedClient` and `ListedTunnel`, whose fields may
be absent under field selection. Select `id` for keyed, actionable rows, or
render anonymous projections without assuming an identifier exists. A denied
category is empty and does not prevent the other category from updating.
Every incoming snapshot replaces both arrays. Previously visible data is
hidden while reconnecting or switching authentication.

## Shared Provider

Use `RstreamProvider` when several components need the same watch stream.

```tsx
"use client";

import { RstreamProvider } from "@rstreamlabs/react/providers";
import { useRstreamContext } from "@rstreamlabs/react/providers";

async function createWatchToken() {
  const response = await fetch("/api/rstream/watch-token", {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to create watch token.");
  }
  const { token } = await response.json();
  return token;
}

function TunnelsTable() {
  const { tunnels } = useRstreamContext();
  return <pre>{JSON.stringify(tunnels, null, 2)}</pre>;
}

export function Dashboard() {
  return (
    <RstreamProvider
      options={{
        auth: createWatchToken,
        engine: "project-endpoint.cluster.example.rstream.test:443",
      }}
    >
      <TunnelsTable />
    </RstreamProvider>
  );
}
```

## WebTTY Terminal

`WebTTYTerminal` binds a WebTTY WebSocket endpoint to an xterm.js terminal. Use
it after a backend has issued a short-lived token scoped to the terminal
session.

```tsx
"use client";

import { WebTTYTerminal } from "@rstreamlabs/react/components";

export function Terminal({
  execPath,
  token,
}: {
  execPath?: string;
  token: string;
}) {
  return (
    <WebTTYTerminal
      execPath={execPath}
      url={`wss://host.example.t.rstream.io?rstream.token=${encodeURIComponent(token)}`}
      terminalOptions={{ cursorBlink: true }}
      onComplete={(exitCode) => console.log("completed", exitCode)}
      onError={(message) => console.error(message)}
    />
  );
}
```

The component loads xterm.js add-ons for fit, Unicode, web links, and WebGL
rendering. It forwards WebTTY stdout/stderr events and keeps terminal resize
state synchronized with the remote session. When the terminal comes from WebTTY
inventory, pass the advertised `exec_path` value as `execPath`.

For an existing managed execution, pass `attach` with the authorized participant
grant and `managed={{ capabilities }}` with capabilities fetched from the same
Engine. The component forwards these options to WebTTY and joins with Attach,
without launching another command. Use `interactive={false}` and
`allocateTty={false}` for a reader that should send neither input nor resize.

`onSessionReady(session)` receives the acknowledged WebTTY handle. Its
`managedSessionId` identifies the execution, and `canTerminate()` reports native
and Engine support. An authorized controller can call `requestTermination()`;
only `onComplete` confirms the native result. Unmounting disconnects the reader
without requesting termination. Other terminal components retain their sessions.

## Security Notes

Browser watch streams should receive a fresh short-lived watch token from a
backend endpoint for each connection attempt. The token is sent to the engine as
`rstream.token` on `/api/sse` or `/api/websocket`, so it must be an `auth` or
`app` token with bounded lifetime, explicit read-only watch permissions, and
list-only tunnel resources. Do not embed personal access tokens or application
client secrets in React code.

## Development

```sh
npm --workspace @rstreamlabs/react run type-check
npm --workspace @rstreamlabs/react run lint
npm --workspace @rstreamlabs/react run build
```
