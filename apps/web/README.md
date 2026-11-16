# Browser WebTTY example

This small Next.js app demonstrates `@rstreamlabs/react/components` opening a
terminal from an authorized WebTTY URL. It is a browser client; it does not load
CLI credentials or issue tokens. Use Node.js 24 and npm 10.9.2 for this workspace.

## Prepare and run

From the repository root, install and build workspace dependencies:

```sh
npm ci
npm run build
npm run dev --workspace @rstreamlabs/web
```

Open `http://localhost:3000/webtty`. In another terminal, an installed rstream
CLI can start a deliberately local-only test server without an account:

```sh
rstream webtty server --listen 127.0.0.1:8080 --allow-unauthenticated \
  --allowed-origin http://localhost:3000
```

Keep this unauthenticated fixture on loopback. Enter `ws://127.0.0.1:8080` in the
page, select **Connect**, and run `whoami` in the terminal. The command runs as
the local WebTTY server process user. Stop both processes with an interrupt.
For published/managed servers, use an authorized URL and the server's required
trust material instead; see the [WebTTY guide](../../packages/webtty/README.md).
The visible journal reports connection state without copying grants from URLs.

A product integration should have its backend authenticate the user and issue
fresh, narrowly scoped session rights. This form is an operator demo, not a
session-authorization backend. The [terminal workspace example](../../packages/terminal-ui/README.md#first-workspace)
shows that backend callback boundary; [application examples](https://github.com/rstreamlabs/rstream-examples)
show larger products with provisioning and authorization.

## Verify

From the root, run `npm test --workspace @rstreamlabs/web` after building the
SDKs. It uses an in-process WebSocket fixture and Playwright Chromium, sends a
synthetic URL grant, acknowledges a real WebTTY Open and checks that the grant
never appears in the visible log. Install Chromium with
`npx playwright-core install chromium` if it is not present. Also run this
workspace's `type-check`, `lint` and `build` scripts for application changes.
