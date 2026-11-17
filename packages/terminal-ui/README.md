# Shared terminal UI

WebTTY provides remote terminal and command sessions through rstream. `@rstreamlabs/terminal-ui` supplies their React presentation: a tabbed workspace, an xterm surface and an encryption indicator. The host application remains responsible for authorizing a session before opening it.

## First workspace

Use a React 19.2+ TypeScript application with a CSS-capable bundler (the workspace checks
use Node.js 24). Install the package and its peer dependencies with npm:

```sh
npm install @rstreamlabs/terminal-ui react react-dom @radix-ui/react-tabs \
  @radix-ui/react-hover-card lucide-react @xterm/xterm @xterm/addon-fit \
  @xterm/addon-unicode11 @xterm/addon-web-links @xterm/addon-webgl
```

[examples/workspace.tsx](examples/workspace.tsx) is a complete typed component,
including imports, a compatible `Button`, CSS and an abortable authorization
callback. Copy it into your client application and render `<TerminalWorkspace />`.

```tsx
"use client";

import { useCallback } from "react";
import type { ButtonHTMLAttributes } from "react";
import { WebTTYWorkspace } from "@rstreamlabs/terminal-ui";
import type { WebTTYConnection } from "@rstreamlabs/terminal-ui";
import "@xterm/xterm/css/xterm.css";
import "@rstreamlabs/terminal-ui/theme.css";

function Button({
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "outline" }) {
  return <button type="button" data-variant={variant} {...props} />;
}

export function TerminalWorkspace() {
  const prepareSession = useCallback(
    async (signal: AbortSignal): Promise<WebTTYConnection> => {
      const response = await fetch("/api/terminal/session", {
        method: "POST",
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Terminal authorization failed.");
      const value: unknown = await response.json();
      if (
        value === null ||
        typeof value !== "object" ||
        !("url" in value) ||
        typeof value.url !== "string" ||
        !("transport" in value) ||
        value.transport !== "websocket"
      )
        throw new Error("Invalid terminal authorization response.");
      return { url: value.url, transport: value.transport };
    },
    [],
  );
  return (
    <WebTTYWorkspace
      Button={Button}
      prepareSession={prepareSession}
      onPreparationError={() => window.alert("Terminal authorization failed.")}
      style={{ height: 400 }}
    />
  );
}
```

It imports the two stylesheets once; if your host already imports them globally,
keep only that global import. Non-framework TypeScript hosts can use the small
[CSS declaration](examples/assets.d.ts) with their own bundler's CSS handling.

TypeScript hosts also need `@types/react` and their normal React JSX/bundler
configuration; framework starter projects normally provide these.

The component expects your backend's `POST /api/terminal/session` to authenticate
the current user, authorize one terminal, and return
`{"url":"wss://…?rstream.token=…","transport":"websocket"}` with a fresh,
short-lived grant. Return non-2xx on denial. That route is an application boundary,
not supplied by this package. Do not mint a token in the browser or log the URL.
Use the [Engine API token guide](../tunnels/README.md#scoped-auth-tokens) on the
backend. For a server requiring E2E, return/provide the additional trusted
endpoint and crypto configuration accepted by `WebTTYConnection`; a token-only
example cannot bypass that policy.

On opening a tab the workspace requests a grant; a successful server ACK produces
a connected terminal. Closing a tab releases its reader. Existing managed detached
executions retain their separate server lifecycle. Tailwind v4 hosts also need
`@source "../node_modules/@rstreamlabs/terminal-ui/dist"` in their CSS, with the
path relative to that stylesheet. Provide the host `--background` theme token.

In this checkout, `npm run build --workspace @rstreamlabs/terminal-ui` followed by
`npm run type-check --workspace @rstreamlabs/terminal-ui` compiles both the library
and the example. Runtime tests cover authorization expiry, cancellation, tab
ownership and cleanup with a real local WebTTY fixture.

`WebTTYWorkspace` owns tabs, connection status and terminal cleanup. Supply a
`prepareSession` function that obtains a fresh authorized connection for each
new terminal, plus the application's `Button` component. Keep this callback
stable with `useCallback`. It receives an `AbortSignal`: pass it to authorization
requests so unmounting or changing permissions cancels the work. Late results are
discarded even if the provider cannot cancel. Concurrent clicks prepare one tab
at a time; existing sessions remain mounted when switching tabs. Keep authorization on
the application backend: the workspace does not store a long-lived credential
or mint tokens itself. A fixed shared connection can instead return its existing
URL; its authorization still expires according to the issuer's policy.

`TerminalFrame` is controlled: its host owns tabs and active selection and supplies
`renderTab`, optional fullscreen navigation and a security badge. Up to five tabs
can be opened. Switching tabs keeps inactive panels mounted.

`TerminalSurface` owns xterm, addons, sizing and theme changes. A transport adapter
owns input/output and session completion. It must disable input when a session
closes, stop readers on unmount and never replay terminal input.

Import `@xterm/xterm/css/xterm.css` and `@rstreamlabs/terminal-ui/theme.css` once in
the host. Tailwind consumers must scan the package's `dist` directory with an
`@source` directive. The palette reads the host's `--background` token.

`TerminalCryptoBadge` displays verified public session metadata. Transport-only
sessions do not display an end-to-end encryption badge. Do not pass keys or
credentials to the badge.

Build with `npm run build --workspace @rstreamlabs/terminal-ui`. Release candidates
are packaged and verified by the repository's npm release workflow before stable
publication.
