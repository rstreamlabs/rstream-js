# rstream JavaScript and TypeScript SDKs

rstream makes services reachable through outbound connections, without opening inbound ports on their hosts. These JavaScript and TypeScript packages integrate that connectivity into Node.js applications and provide the APIs and browser components used to manage it.

Start with the package that matches your application. The runtime hosts tunnels in Node.js. The API and browser packages manage and present those connections. Published tunnels expose a forwarding address; private tunnels require an authenticated rstream client. The [SDK guide](https://rstream.io/sdks) compares language runtimes and protocol coverage.

## Choose a package

| Package                                                      | Use it for                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [`@rstreamlabs/runtime`](packages/runtime/README.md)         | Host bytestream tunnels and dial private services from Node.js.                            |
| [`@rstreamlabs/rstream`](packages/rstream/README.md)         | Administer accounts and projects through the Control plane API.                            |
| [`@rstreamlabs/tunnels`](packages/tunnels/README.md)         | Query engine inventory, watch events, issue scoped tokens and obtain TURN credentials.     |
| [`@rstreamlabs/react`](packages/react/README.md)             | Build React interfaces with live engine state and terminal components.                     |
| [`@rstreamlabs/webtty`](packages/webtty/README.md)           | Embed browser terminal and remote command sessions.                                        |
| [`@rstreamlabs/terminal-ui`](packages/terminal-ui/README.md) | Compose a tabbed terminal workspace with application-owned authorization and presentation. |
| [`@rstreamlabs/filesystem`](packages/filesystem/README.md)   | Work with filesystem adapters and streaming WebDAV.                                        |
| [`@rstreamlabs/utils`](packages/utils/README.md)             | Use shared browser utilities, including file-sharing helpers.                              |

The Node.js runtime connects over TLS and supports bytestream tunnels. It does not implement QUIC transport or datagram tunnels. Browser packages use web APIs and do not load the CLI’s local configuration or host native tunnel listeners.

## Serve HTTP from Node.js

Use Node.js 24 and npm. Install the runtime in your application.

```sh
npm install @rstreamlabs/runtime
```

Install the [rstream CLI](https://rstream.io/docs/getting-started/installation), then select a project with `rstream login` and `rstream project use my-project-endpoint`, replacing the endpoint with your own. The runtime reads the same context; services can also supply credentials explicitly.

```js
import http from "node:http";
import { Client } from "@rstreamlabs/runtime";

const client = Client.fromEnv();
const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
try {
  const control = await client.connect({ signal: shutdown.signal });
  try {
    const tunnel = await control.createTunnel({
      protocol: "http",
      httpVersion: "http/1.1",
      publish: true,
    });
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("Hello from rstream");
    });
    console.log(await tunnel.forwardingAddress());
    await tunnel.serve(server, { signal: shutdown.signal });
  } finally {
    await control.close();
  }
} finally {
  process.off("SIGINT", stop);
  await client.close();
}
```

Save as `main.mjs` and run `node main.mjs`. Open the printed HTTPS address
and expect `Hello from rstream`. Stop with Ctrl+C. The
[HTTP and WebSocket walkthrough](docs/runtime/000-http-and-websocket.md)
runs the checkout's examples and shows how to verify the response.

## Documentation

The [guide index](docs/README.md) starts with source setup and follows the
three integration paths for Node runtime, backend APIs and browser clients. The [browser demo](apps/web/README.md) is a small operator terminal; the [application collection](https://github.com/rstreamlabs/rstream-examples) shows provisioning, private workers and framework lifecycles.

For browser applications, issue short-lived, narrowly scoped tokens from a backend. Keep application secrets and administrative tokens on the server; the [Engine API guide](packages/tunnels/README.md) explains token issuance.

## Contributing, security and support

[Contributing](CONTRIBUTING.md) covers workspace setup and checks; follow the [coding style](CODING_STYLE.md) when changing packages. Report vulnerabilities through [Security](SECURITY.md). Use [GitHub issues](https://github.com/rstreamlabs/rstream-js/issues) for questions and reproducible bugs, with credentials and customer details removed. Licensed under [Apache-2.0](LICENSE).
