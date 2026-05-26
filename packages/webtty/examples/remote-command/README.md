# `rstream-webtty-remote-command-example`

Example of using `@rstreamlabs/webtty` to run collected and streaming commands through a WebTTY server.

The sample only needs the WebTTY URL. If you build an inventory-driven integration, pass the advertised `exec_path` from `rstream webtty list -o json` as the SDK `execPath` option.

```sh
cp .env.local.example .env.local
npm install
npm start
```
