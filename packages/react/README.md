# `@rstreamlabs/react`

rstream connects services and devices through outbound tunnels and exposes their live state through engine APIs. This package brings that state and remote terminal access into a React application through hooks, providers and components.

Use this package in browser applications and dashboards that need live tunnel
state or embedded WebTTY sessions. It builds on
[`@rstreamlabs/tunnels`](https://github.com/rstreamlabs/rstream-js/blob/main/packages/tunnels/README.md) for watch streams and
[`@rstreamlabs/webtty`](https://github.com/rstreamlabs/rstream-js/blob/main/packages/webtty/README.md) for the browser-side WebTTY
protocol.

## Install

```sh
npm install @rstreamlabs/react
```

The package requires React 19.2.8 or newer within React 19. It uses the application's React instance; React 18, 19.0 and 19.1 are not supported.

## Exports

| Import path                     | Contents                                |
| ------------------------------- | --------------------------------------- |
| `@rstreamlabs/react`            | Hooks, providers, and components.       |
| `@rstreamlabs/react/hooks`      | `useRstream`.                           |
| `@rstreamlabs/react/providers`  | `RstreamProvider`, `useRstreamContext`. |
| `@rstreamlabs/react/components` | `WebTTYTerminal`.                       |

## Live Tunnel State

Use [the browser token route](https://rstream.io/docs/integrations/browser-clients)
to get an authorized Engine and short-lived watch token. For this example,
install `zod` alongside the React SDK. Pass in the Engine returned by the
initial bootstrap. Use the token callback for subsequent connections.

```tsx
"use client";

import { useRstream } from "@rstreamlabs/react/hooks";
import { useCallback } from "react";
import { z } from "zod";

const credentials = z.object({ token: z.string(), engine: z.string() });

async function watchToken(engine: string) {
  const response = await fetch("/api/rstream/watch", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Watch access was refused");
  const issued = credentials.parse(await response.json());
  if (issued.engine !== engine) throw new Error("The selected Engine changed");
  return issued.token;
}

export function TunnelInventory({ engine }: { engine: string }) {
  const auth = useCallback(() => watchToken(engine), [engine]);
  const { state, error, tunnels } = useRstream({
    auth,
    engine,
    transport: "sse",
  });

  if (error) return <p>{error.message}</p>;
  return (
    <ul data-state={state}>
      {tunnels.flatMap((tunnel) =>
        tunnel.id ? [<li key={tunnel.id}>{tunnel.name ?? tunnel.id}</li>] : [],
      )}
    </ul>
  );
}
```

The hook reconnects and obtains fresh credentials. Use a stable callback
for the same Engine and remount the view when the selected project changes.
Watch items are field projections. Select `id` for rows the viewer can
act on. Each new snapshot replaces the current view.

## Shared Provider

Use `RstreamProvider` when several components share one subscription.
Pass the same options and read the view with `useRstreamContext()`.

```tsx
import { RstreamProvider } from "@rstreamlabs/react/providers";
import { useRstreamContext } from "@rstreamlabs/react/providers";
import { useCallback } from "react";

function TunnelCount() {
  const { tunnels } = useRstreamContext();
  return <p>{tunnels.length} tunnels</p>;
}

export function Dashboard({ engine }: { engine: string }) {
  const auth = useCallback(() => watchToken(engine), [engine]);
  return (
    <RstreamProvider options={{ engine, auth }}>
      <TunnelCount />
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
