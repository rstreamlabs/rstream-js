# Interactive WebTTY sessions

Resolve and authorize a connection on your backend. Pass the fresh endpoint and its advertised transport to the browser client.

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

Call `closeStdin()` to send EOF, or `disconnect()` to release the reader.
For an Engine-managed detached execution, releasing the reader leaves the
command running within its original execution budget.

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
