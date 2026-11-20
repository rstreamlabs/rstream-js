# `@rstreamlabs/webtty`

WebTTY connects an authorized client to a terminal or command on a
remote machine. This package handles session input, output, resizing
and completion over WebSocket or WebTransport. An application backend
decides who can reach each server and supplies a scoped connection.

```sh
npm install @rstreamlabs/webtty
```

| I need to | Start with |
| --- | --- |
| Authorize and open a terminal from a browser | [WebTTY browser setup](https://rstream.io/docs/webtty/sdk-browser). |
| Handle input, output, errors and disconnect in my own UI | [Interactive sessions](https://github.com/rstreamlabs/rstream-js/blob/main/packages/webtty/docs/001-interactive-sessions.md). |
| Run a command or follow a managed execution | [Commands](https://github.com/rstreamlabs/rstream-js/blob/main/packages/webtty/docs/002-commands.md). |
| Replay a recording or work with files | [Recordings and files](https://github.com/rstreamlabs/rstream-js/blob/main/packages/webtty/docs/003-recordings-and-files.md). |
| Select transport and verify the remote endpoint | [Transports and endpoint trust](https://github.com/rstreamlabs/rstream-js/blob/main/packages/webtty/docs/004-transports-and-crypto.md). |

For an existing React UI, use [React](https://github.com/rstreamlabs/rstream-js/blob/main/packages/react/README.md) for a single
terminal or [Terminal UI](https://github.com/rstreamlabs/rstream-js/blob/main/packages/terminal-ui/README.md) for a workspace.

## Examples

| Example | What it shows |
| --- | --- |
| [Remote command](https://github.com/rstreamlabs/rstream-js/tree/main/packages/webtty/examples/remote-command) | Run and observe a permitted command against an authorized WebTTY endpoint. |
| [Filesystem sidecar](https://github.com/rstreamlabs/rstream-js/tree/main/packages/webtty/examples/filesystem-sidecar) | List and read files through the authorized sidecar. |

For workspace checks and package maintenance, follow
[Contributing](https://github.com/rstreamlabs/rstream-js/blob/main/CONTRIBUTING.md).
