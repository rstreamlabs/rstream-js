# Interactive WebTTY sessions

Resolve and authorize a connection on your backend. Pass the fresh endpoint and its advertised transport to the browser client.

## Open an interactive terminal

Use a WebTTY server that permits interactive sessions and can allocate a
pseudoterminal. This example uses an authorized WebSocket URL and submits
one line after the server acknowledges the session.

```ts
import { WebTTY } from "@rstreamlabs/webtty";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const terminal = new WebTTY(
  { url: "wss://host.example.t.rstream.io?rstream.token=<token>" },
  { allocateTty: true, interactive: true },
  {
    onConnect: () => {
      terminal.resize(40, 120);
      terminal.writeStdin(encoder.encode("whoami\n"));
    },
    onStdout: (chunk) => console.log(decoder.decode(chunk, { stream: true })),
    onComplete: (exitCode) => console.log("completed", exitCode),
    onError: (message) => console.error(message),
  },
);

terminal.connect();
```

Expect the account name in the terminal output. A terminal UI should pass its
input and resize events to `writeStdin()` and `resize()`. Call `closeStdin()` to
send EOF and `disconnect()` when closing the view. For a session already
running as a detached execution, disconnecting releases the reader and the
command retains its original execution budget.

Use the [command API](002-commands.md) when you need a bounded command result.

## Connection failures and diagnostics

Connection failures are delivered once through `onError`, including normal
WebTransport closure before the stream opens. Disconnecting also releases a
stream that becomes available after the opening was cancelled. A normal close
after opening still drains buffered output before reporting the session result.

Error messages redact values from the configured endpoint's query parameters,
userinfo and fragment, including their common URL-encoded forms. Avoid logging
the endpoint separately. An identifiable browser `SecurityError` points to
browser policy and `connect-src`; an empty browser error reports that diagnostic
details are unavailable. Such an error does not establish that CSP is the cause.
Invalid endpoint configuration still throws synchronously without echoing the URL.

## Events

| Event                         | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `onConnect`                   | Called after the server acknowledges the session.                  |
| `onStdout` / `onStderr`       | Called with stream chunks from the remote process.                 |
| `onStdoutEos` / `onStderrEos` | Called when the corresponding stream reaches EOS.                  |
| `onComplete`                  | Called with the remote process exit code.                          |
| `onError`                     | Called for server errors, protocol errors, or connection failures. |
