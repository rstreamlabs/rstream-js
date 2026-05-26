# `rstream-webtty-filesystem-sidecar-example`

Example of using `@rstreamlabs/webtty` to read and write files through the optional WebDAV filesystem sidecar.

The sample only needs the WebTTY URL. If you build an inventory-driven integration, pass the advertised `fs_path` from `rstream webtty list -o json` as the SDK `fsPath` option.

```sh
cp .env.local.example .env.local
npm install
npm start
```
