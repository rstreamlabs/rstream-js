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

export function TunnelInventory({ token }: { token: string }) {
  const { state, error, tunnels } = useRstream({
    auth: token,
    engine: "project-endpoint.cluster.example.rstream.test:443",
    transport: "sse",
  });

  if (error) return <p>{error.message}</p>;
  return (
    <ul data-state={state}>
      {tunnels.map((tunnel) => (
        <li key={tunnel.id}>{tunnel.name ?? tunnel.id}</li>
      ))}
    </ul>
  );
}
```

The hook reconnects automatically and clears state when authentication is not
configured.

## Shared Provider

Use `RstreamProvider` when several components need the same watch stream.

```tsx
"use client";

import { RstreamProvider } from "@rstreamlabs/react/providers";
import { useRstreamContext } from "@rstreamlabs/react/providers";

function TunnelsTable() {
  const { tunnels } = useRstreamContext();
  return <pre>{JSON.stringify(tunnels, null, 2)}</pre>;
}

export function Dashboard({ token }: { token: string }) {
  return (
    <RstreamProvider
      options={{
        auth: token,
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

export function Terminal({ token }: { token: string }) {
  return (
    <WebTTYTerminal
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
state synchronized with the remote session.

## Security Notes

Browser applications should receive short-lived tokens from a backend endpoint.
Do not embed personal access tokens or application client secrets in React code.

## Development

```sh
npm --workspace @rstreamlabs/react run type-check
npm --workspace @rstreamlabs/react run lint
npm --workspace @rstreamlabs/react run build
```
