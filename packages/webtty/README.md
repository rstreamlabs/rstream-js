# `@rstreamlabs/webtty`

Browser-side client for the rstream WebTTY protocol.

Use this package when you need to connect a web application to a WebTTY server
over WebSocket. It handles the protobuf session handshake, stdin/stdout/stderr
streams, remote process completion, terminal resize events, and heartbeats.

For a ready-made React terminal, use
[`@rstreamlabs/react`](../react/README.md).

## Install

```sh
npm install @rstreamlabs/webtty
```

## Connect to a WebTTY Session

```ts
import { WebTTY } from "@rstreamlabs/webtty";

const decoder = new TextDecoder();

const webtty = new WebTTY(
  {
    url: "wss://host.example.t.rstream.io?rstream.token=<token>",
  },
  {
    cmdArgs: ["uname", "-a"],
    interactive: false,
  },
  {
    onConnect: () => {
      console.log("connected");
    },
    onStdout: (chunk) => {
      console.log(decoder.decode(chunk));
    },
    onComplete: (exitCode) => {
      console.log("completed", exitCode);
    },
    onError: (message) => {
      console.error(message);
    },
  },
);

webtty.connect();
```

## Interactive Sessions

For an interactive terminal, write encoded input to stdin and forward terminal
resize events.

```ts
const encoder = new TextEncoder();

const webtty = new WebTTY(
  { url: "wss://host.example.t.rstream.io?rstream.token=<token>" },
  { allocateTty: true, interactive: true },
);

webtty.connect();

// After onConnect fires:
webtty.writeStdin(encoder.encode("whoami\n"));
webtty.resize(40, 120);
```

Call `closeStdin()` to send EOF, or `disconnect()` to terminate the client
session.

## Execute Commands

For non-interactive agent workflows, use `runWebTTYCommand` or
`executeWebTTYCommand`. Both open a WebTTY session, collect stdout and stderr,
and resolve when the remote command exits.

```ts
import { runWebTTYCommand } from "@rstreamlabs/webtty";

const result = await runWebTTYCommand(
  { url: "wss://host.example.t.rstream.io?rstream.token=<token>" },
  "sh",
  ["-lc", "docker ps --format '{{.Names}}'"],
  { timeoutMs: 30_000 },
);

if (!result.success) {
  throw new Error(
    result.stderr || `Remote command exited with ${result.exitCode}`,
  );
}

console.log(result.stdout);
```

Use `openWebTTYCommand` when you need live control over a running command. It
returns a command object with replayable stdout/stderr, ordered log iteration,
stdin writes, EOF handling, `wait()`, and `kill()`/`terminate()` session
cleanup.

```ts
import { openWebTTYCommand } from "@rstreamlabs/webtty";

const command = openWebTTYCommand(
  { url: "wss://host.example.t.rstream.io?rstream.token=<token>" },
  {
    cmdArgs: ["sh", "-lc", "npm test"],
    timeoutMs: 120_000,
  },
);

for await (const entry of command.logs()) {
  process[entry.stream === "stdout" ? "stdout" : "stderr"].write(entry.data);
}

const status = await command.wait();

if (!status.success) {
  throw new Error(`Remote command exited with ${status.exitCode}`);
}
```

Use `WebTTYRemoteExecutor` when the URL is resolved lazily, for example from a
fresh short-lived token. When the WebTTY server is discovered through
`@rstreamlabs/tunnels`, pass the advertised `exec_path` value as `execPath`
instead of assuming `/`.

## Filesystem Sidecar

When a WebTTY server is started with `--fs-root`, the optional WebDAV sidecar
advertises an `fs_path` value. Paths passed to the SDK are relative to that
configured root.

```ts
import { WebTTYFileSystem } from "@rstreamlabs/webtty";

const fs = new WebTTYFileSystem({
  url: "https://host.example.t.rstream.io?rstream.token=<token>",
});

const files = await fs.list("/");
const compose = await fs.readText("/compose.yaml");
const stream = await fs.readStream("/large.log");

await fs.writeFile("/notes/codex.txt", "checked by Codex\n");
```

When the WebTTY server is discovered through `@rstreamlabs/tunnels`, pass the
advertised `fs_path` value as `fsPath` instead of assuming `/fs`.

`WebTTYFileSystem` also exposes fs-style aliases such as `readFile`,
`writeFile`, `readdir`, `mkdir`, `stat`, `rename`, `copyFile`, `rm`, and
`exists` for code that expects a familiar filesystem shape.

The filesystem sidecar is a WebDAV boundary, not a sandbox. It is rooted by the
server-side `--fs-root` option and runs with the WebTTY server process
permissions.

## Examples

Runnable examples live under `examples/`:

- `examples/remote-command` runs collected and streaming commands.
- `examples/filesystem-sidecar` reads and writes through the WebDAV sidecar.

## Configuration

Client-level options:

| Option                | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `url`                 | WebSocket endpoint for the WebTTY server.               |
| `sendHeartbeat`       | Send heartbeat messages. Defaults to `true`.            |
| `heartbeatIntervalMs` | Heartbeat interval in milliseconds. Defaults to `5000`. |

Execution options:

| Option        | Purpose                                                 |
| ------------- | ------------------------------------------------------- |
| `cmdArgs`     | Command arguments requested for the remote session.     |
| `envVars`     | Environment variables requested for the remote session. |
| `allocateTty` | Ask the server for a TTY. Defaults to `true`.           |
| `interactive` | Enable stdin. Defaults to `true`.                       |
| `username`    | Optional user name or numeric user ID.                  |
| `workdir`     | Optional working directory.                             |

The remote WebTTY server decides which execution options are accepted. Treat
these values as requests, not local privilege boundaries.

## Events

| Event                         | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `onConnect`                   | Called after the server acknowledges the session.                  |
| `onStdout` / `onStderr`       | Called with stream chunks from the remote process.                 |
| `onStdoutEos` / `onStderrEos` | Called when the corresponding stream reaches EOS.                  |
| `onComplete`                  | Called with the remote process exit code.                          |
| `onError`                     | Called for server errors, protocol errors, or connection failures. |

## Security Notes

Browser WebTTY sessions should use short-lived tokens scoped to the specific
tunnel and path. Do not embed personal access tokens or application credentials
in frontend code.

## Development

```sh
npm --workspace @rstreamlabs/webtty run test
npm --workspace @rstreamlabs/webtty run type-check
npm --workspace @rstreamlabs/webtty run lint
npm --workspace @rstreamlabs/webtty run build
```
