# rstream JavaScript and TypeScript SDKs

rstream makes services reachable through outbound connections, without opening inbound ports on their hosts. These JavaScript and TypeScript packages integrate that connectivity into Node.js applications and provide the APIs and browser components used to manage it.

Choose a package by the job it performs: hosting a tunnel in Node.js, administering a project, querying an engine or embedding a browser interface are different integration paths. Published tunnels expose a forwarding address; private tunnels require an authenticated rstream client. The [SDK guide](https://rstream.io/docs/sdks) compares language runtimes and protocol coverage.

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

The example below uses Node.js 24 and npm. Install the runtime in your application:

```sh
npm install @rstreamlabs/runtime
```

Install the [rstream CLI](https://rstream.io/docs/getting-started/installation), then select a project with `rstream login` and `rstream project use my-project-endpoint`, replacing the endpoint with your own. The runtime reads the same context; services can also supply credentials explicitly.

```ts
import http from "node:http";
import { Client } from "@rstreamlabs/runtime";

const client = Client.fromEnv();
const control = await client.connect();
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
  await tunnel.serve(server);
} finally {
  await control.close();
  await client.close();
}
```

Save the program as `main.mjs` and run `node main.mjs`. The printed address reaches the Node HTTP handler directly, without a local TCP listening port. See the [runtime guide](packages/runtime/README.md) for configuration, private dialing, WebSocket upgrades and lifecycle handling.

## Documentation

Start with the package guide matching your task in the table above. The [documentation index](docs/README.md) connects authentication, engine APIs, browser integration and runtime options. The [application examples](apps) show larger integrations.

For browser applications, issue short-lived, narrowly scoped tokens from a backend. Keep application secrets and administrative tokens on the server; the [Engine API guide](packages/tunnels/README.md) explains token issuance.

## Contributing, security and support

[Contributing](CONTRIBUTING.md) covers workspace setup and checks; follow the [coding style](CODING_STYLE.md) when changing packages. Report vulnerabilities through [Security](SECURITY.md). Use [GitHub issues](https://github.com/rstreamlabs/rstream-js/issues) for questions and reproducible bugs, with credentials and customer details removed. Licensed under [Apache-2.0](LICENSE).
