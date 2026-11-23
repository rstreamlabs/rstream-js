# `rstream-webtty-remote-command-example`

Example of using `@rstreamlabs/webtty` to run collected and streaming commands through a WebTTY server.

[Build the checkout](../../../../docs/000-building-from-source.md), then copy the example environment file from this directory.

```sh
cp .env.local.example .env.local
```

Set `RSTREAM_WEBTTY_URL` in `.env.local` to an authorized URL. For a service
discovered through the inventory, pass the advertised `exec_path` from
`rstream webtty list -o json` as the SDK's `execPath` option. Then run the sample.

```sh
npm install
npm start
```

The Node entry point supplies `nodeWebSocketFactory`, so it uses the qualified HTTP/1.1
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
