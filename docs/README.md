# JavaScript and TypeScript SDK guides

Choose the package that owns the work your application needs. A Node.js
service can create and accept tunnels. Backend APIs manage connectivity
and authorize short-lived access for the browser.

## Run a first Node.js application

| Starting point                              | First result                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A new application using a published package | [Install the runtime and serve HTTP](runtime/000-http-and-websocket.md#serve-http-with-the-published-package).                             |
| A checkout of this repository               | [Build the SDKs](000-building-from-source.md), then [run a checkout program](runtime/000-http-and-websocket.md#run-the-checkout-programs). |

Both paths use a project or direct Engine context. After the first request,
[configure the runtime](001-runtime-configuration.md) for your deployment.
The [tunnel options](002-tunnel-options.md) help you choose a tunnel and
apply its access policy.

## Integrate a Node.js service

| Task                                                | Guide                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Serve an HTTP request or handle a WebSocket upgrade | [HTTP and WebSocket](runtime/000-http-and-websocket.md).          |
| Dial an internal service or publish TCP or TLS      | [Private services, TCP and TLS](runtime/001-private-services.md). |
| Handle disconnects, close resources and recover     | [Runtime lifecycle](runtime/002-lifecycle.md).                    |

## Integrate management and browser clients

| Task                                                                   | Guide                                                                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Manage accounts, projects and webhook destinations                     | [Control plane SDK](../packages/rstream/README.md).                                                                                |
| Query or watch an Engine, mint scoped tokens or issue TURN credentials | [Engine API SDK](../packages/tunnels/README.md).                                                                                   |
| Authorize a browser watch                                              | [Watch credentials and state](browser/000-watch.md).                                                                               |
| Embed a React view or remote terminal                                  | [React](../packages/react/README.md), [WebTTY](../packages/webtty/README.md) and [Terminal UI](../packages/terminal-ui/README.md). |
| Work with file transfers                                               | [Filesystem](../packages/filesystem/README.md).                                                                                    |

[Contributing](../CONTRIBUTING.md) covers the workspace's build, tests and
package development.
