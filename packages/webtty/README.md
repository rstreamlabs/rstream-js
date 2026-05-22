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
