# JavaScript and TypeScript SDK documentation

Choose the API boundary before installing a package. Creating a tunnel in a Node process, inspecting a running engine and administering a managed project are different operations.

| Goal | Guide |
| --- | --- |
| Run a Node.js service through rstream | [Runtime SDK](../packages/runtime/README.md) |
| Manage accounts, projects and webhook destinations | [Control plane SDK](../packages/rstream/README.md) |
| Query or watch engines, verify webhooks and issue scoped tokens | [Engine API SDK](../packages/tunnels/README.md) |
| Build a browser UI | [React integration](../packages/react/README.md) |
| Embed remote terminal access | [WebTTY](../packages/webtty/README.md) |
| Integrate file access | [Filesystem](../packages/filesystem/README.md) |
| Configure HTTP tunnel policy | [Node.js tunnel options](tunnel-options.md) |
| Develop a package | [Contributing](../CONTRIBUTING.md) |

The runtime uses the local CLI configuration and supports token or file-based certificate authentication. API clients also accept explicit credentials. Browser integrations obtain limited tokens from an application backend; application secrets remain on that backend. Each package guide describes its supported credentials and runtime environments.
