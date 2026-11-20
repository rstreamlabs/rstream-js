# JavaScript and TypeScript SDK guides

Choose the package that owns the work your application needs. A Node.js
service can create and accept tunnels. Backend APIs manage connectivity
and authorize short-lived access for the browser.

| To get running | Read |
| --- | --- |
| Install a published package | [Choose a package](../README.md#choose-a-package). |
| Build this checkout | [Source setup](002-building-from-source.md). |
| Select a project, direct Engine or service credential | [Runtime configuration](000-runtime-configuration.md). |

## Integrate a Node.js service

| Task | Guide |
| --- | --- |
| Serve an HTTP request or handle a WebSocket upgrade | [HTTP and WebSocket](runtime/000-http-and-websocket.md). |
| Dial an internal service or publish TCP | [Private and TCP services](runtime/001-private-services.md). |
| Handle disconnects, close resources and recover | [Runtime lifecycle](runtime/002-lifecycle.md). |
| Look up tunnel creation, admission and HTTP policies | [Tunnel options](001-tunnel-options.md). |

## Integrate management and browser clients

| Task | Guide |
| --- | --- |
| Manage accounts, projects and webhook destinations | [Control plane SDK](../packages/rstream/README.md). |
| Query or watch an Engine, mint scoped tokens or issue TURN credentials | [Engine API SDK](../packages/tunnels/README.md). |
| Authorize a browser watch | [Watch credentials and state](browser/000-watch.md). |
| Embed a React view or remote terminal | [React](../packages/react/README.md), [WebTTY](../packages/webtty/README.md) and [Terminal UI](../packages/terminal-ui/README.md). |
| Work with file transfers | [Filesystem](../packages/filesystem/README.md). |

[Contributing](../CONTRIBUTING.md) covers the workspace's build, tests and
package development.
