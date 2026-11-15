# `rstream-webtty-remote-command-example`

Example of using `@rstreamlabs/webtty` to run collected and streaming commands through a WebTTY server.

The sample only needs the WebTTY URL. If you build an inventory-driven integration, pass the advertised `exec_path` from `rstream webtty list -o json` as the SDK `execPath` option.

```sh
cp .env.local.example .env.local
npm install
npm start
```

Use Node.js 24 and npm from this directory after building the monorepo. The Node
entry point supplies `nodeWebSocketFactory`, so it uses the qualified HTTP/1.1
WebSocket transport with certificate verification. Set `NODE_EXTRA_CA_CERTS`
before starting the process when the endpoint uses a private CA. The two commands
print collected output and then three streamed ticks. The remote server must
permit these commands and satisfy any endpoint/E2E trust policy; the sample does
not create a server or mint its URL grant.

After installation, run `npm run type-check` to check the sample against the
package types. From the monorepo root after building,
`node --test packages/webtty/test/remote-command-example.test.cjs` runs this
entrypoint against a synthetic TLS/WebSocket server without relying on a global
WebSocket. It verifies both commands and the selected HTTP/1.1 transport; it does
not execute a shell on a real host.
