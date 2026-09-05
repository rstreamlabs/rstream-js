# `@rstreamlabs/webtty`

Browser-side client for the rstream WebTTY protocol.

Use this package when you need to connect a web application to a WebTTY server
over WebSocket or WebTransport. It handles the protobuf session handshake,
stdin/stdout/stderr streams, remote process completion, terminal resize events,
and heartbeats.

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

### Managed session attach

Engine-managed sessions are joined with a WebTTY `Attach` message. The attach
grant is obtained from the control-plane API, then sent as the first protobuf
message on the terminal stream. Terminal input and output stay on the WebTTY
data path. The current engine live participant stream accepts WebSocket-backed
sessions only; WebTransport attach encoding is available in the protocol/SDK,
but engines that do not expose a WebTransport participant stream reject those
sessions before issuing an attach grant.

```ts
import { WebTTY } from "@rstreamlabs/webtty";

const session = new WebTTY({
  attach: {
    attachGrant,
    capabilities: ["read_stream", "request_control"],
    participantId,
    sessionId,
  },
  url: participantStreamUrl,
});

session.connect();
```

## Recorded Session Replay

The package exposes replay helpers for product-managed WebTTY recordings. The
helpers are public so applications can inspect and audit the decrypt/transcript
path instead of relying on product UI code.

```ts
import {
  createWebTTYE2EReplayPayloadCryptoFromKeyGrant,
  decryptWebTTYRecordedEvent,
  decryptWebTTYRecordedTextLog,
} from "@rstreamlabs/webtty";

const payloadCrypto = await createWebTTYE2EReplayPayloadCryptoFromKeyGrant(
  decryptMaterialGrant,
  localWorkspaceDeviceWebTTYIdentity,
);

for (const event of recordedEvents) {
  const chunk = await decryptWebTTYRecordedEvent(event, payloadCrypto);
  if (chunk) {
    // chunk.stream is "stdin", "stdout", or "stderr"; chunk.data is bytes.
  }
}

const transcript = await decryptWebTTYRecordedTextLog(
  recordedEvents,
  payloadCrypto,
);
console.log(transcript.text);
```

`decryptWebTTYRecordedTextLog` renders a readable terminal transcript from
recorded data events. It omits closed alternate-screen applications from the
transcript, matching terminal scrollback behavior. If the recording ends while
alternate screen is still active, the current alternate-screen snapshot is
included by default. Use raw decrypted events when you need full forensic data.

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
permissions. It is not part of the encrypted WebTTY protobuf payload stream and
is intentionally kept separate from WebTTY E2E payload encryption.

## Examples

Runnable examples live under `examples/`:

- `examples/remote-command` runs collected and streaming commands.
- `examples/filesystem-sidecar` reads and writes through the WebDAV sidecar.

## Configuration

Client-level options:

| Option                | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `url`                 | WebSocket or WebTransport endpoint for the WebTTY server.   |
| `transport`           | Optional transport override: `websocket` or `webtransport`. |
| `sendHeartbeat`       | Send heartbeat messages. Defaults to `true`.                |
| `heartbeatIntervalMs` | Heartbeat interval in milliseconds. Defaults to `5000`.     |

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

## Transports

The browser client uses WebSocket by default:

```ts
const terminal = new WebTTY({ url: "wss://terminal.example/session" });
```

Use WebTransport when the endpoint is published over HTTP/3 WebTransport:

```ts
const terminal = new WebTTY({
  transport: "webtransport",
  url: "https://terminal.example/session",
});
```

Both transports carry the same WebTTY protobuf messages. WebTransport uses the
same length-prefixed protobuf framing as the Go WebTransport implementation.

For local WebTransport tests that use an ephemeral self-signed certificate, pass
the browser WebTransport certificate pinning options through `webTransportOptions`:

```ts
const terminal = new WebTTY({
  transport: "webtransport",
  url: "https://127.0.0.1:8443/",
  webTransportOptions: {
    serverCertificateHashes: [
      { algorithm: "sha-256", value: certificateSha256 },
    ],
  },
});
```

Production endpoints should normally rely on publicly trusted TLS certificates
and leave `webTransportOptions` unset.

## Payload Crypto Hooks

Managed WebTTY can keep the protobuf session envelope visible to the server
while carrying stdin/stdout/stderr bytes as encrypted payloads. This lets the
server route sessions, record metadata, enforce policy, and track lifecycle
events without receiving plaintext terminal bytes.

The SDK exposes payload crypto hooks through `payloadCrypto`. It also provides
`generateWebTTYE2EIdentity`, `createWebTTYE2EClientPayloadCrypto`, and
`createWebTTYE2EServerPayloadCrypto` helpers for WebCrypto-backed E2E payload
encryption.

Implemented E2E suites:

| Layer         | Suite                                                                |
| ------------- | -------------------------------------------------------------------- |
| Payload bytes | AES-256-GCM with a fresh 96-bit nonce per WebTTY data message        |
| Key envelope  | HPKE Base mode: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM |

Crypto helpers attach a `cryptoInfo` object to the returned `payloadCrypto`.
UI bindings can use it to display runtime security details without hard-coding
suite names. The object reports the E2E mode, payload cipher, tag and nonce
sizes, key agreement, key derivation, and key-encryption suites that are
actually configured for the session.

The WebTTY protobuf envelope remains visible for routing and policy; only the
stdin/stdout/stderr payload bytes are encrypted by these helpers.

Key identifiers and X25519 key material can be passed as raw `Uint8Array`
values or as unpadded base64url strings, matching the local WebTTY identity
files generated by the rstream CLI.

When a client needs replay/decrypt grants to point at product resources instead
of opaque public keys, pass typed recipients to
`createWebTTYE2EClientPayloadCrypto`:

```ts
const crypto = await createWebTTYE2EClientPayloadCrypto({
  recipients: [
    {
      id: "keyset-1",
      keyId: workspaceRecipientKeyId,
      kind: "workspace_keyset",
      publicKey: workspaceRecipientPublicKey,
    },
  ],
});
```

The helper builds the WebTTY `key_context` before HPKE wrapping, so the context
is covered by the HPKE authenticated data. `createWebTTYE2EKeyContext` is also
available when the application needs to provide the context explicitly with
workspace, project, or server identifiers.

Recorded engine events may expose both `key_context` and `key_context_raw`.
Replay and decrypt flows must prefer `key_context_raw` when it is present. It is
the unpadded base64url encoding of the exact context bytes used for HPKE/AAD;
`key_context` is a readable metadata projection and can be affected by JSON
normalization after storage.

Browser applications do not read environment variables or `.rstream` files. They
must receive either an explicit known server endpoint identity or a
workspace-managed trust grant before creating the WebTTY client. When an
endpoint identity is configured, the browser verifies the server proof before it
sends the WebTTY `Open` message. When the server requires client authentication,
the browser also needs a local client endpoint identity so it can sign a
`ClientProof`.

Node.js applications that run beside the rstream CLI can use the local trust
helper to apply the same WebTTY trust-store resolution as the CLI and native
clients:

```ts
import { createWebTTYE2EClientPayloadCryptoFromLocalTrust } from "@rstreamlabs/webtty/node";

const payloadCrypto = await createWebTTYE2EClientPayloadCryptoFromLocalTrust({
  required: true,
});
```

The helper resolves `RSTREAM_WEBTTY_KNOWN_SERVER_KEY`,
`RSTREAM_WEBTTY_KNOWN_SERVERS_FILE`, and the default
`~/.rstream/webtty/known_servers.json` file. If no trust material exists and
`required` is not set, it returns `undefined` so plaintext WebTTY sessions remain
available for unprotected servers.

The WebDAV filesystem sidecar is a separate HTTP/WebDAV surface. It is not
covered by WebTTY payload crypto and should not be presented as protected by
WebTTY E2E encryption.

Protocol suite identifiers currently represented in the WebTTY protobuf
contract are:

| Field              | Protocol identifiers                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `payloadSuite`     | `aes-256-gcm`, `chacha20-poly1305`                                                 |
| `keyEnvelopeSuite` | `hpke-x25519-hkdf-sha256-aes-256-gcm`, `hpke-x25519-hkdf-sha256-chacha20-poly1305` |

The helpers in this package support only the AES-256-GCM payload suite and the
HPKE/X25519/HKDF-SHA256/AES-256-GCM key-envelope suite. ChaCha20-Poly1305
identifiers are reserved for forward compatibility and are rejected by the
current helpers.

Do not derive payload keys from passwords or application strings.

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

## Shared filesystem backend

`WebTTYFileSystem` and its existing exports remain available. The implementation now lives in `@rstreamlabs/filesystem`, which also exports `WebDAVFileSystem` and the transport-independent `FileSystemBackend` interface. Existing WebTTY write helpers and configuration are preserved. New read clients can use `readStream` to avoid buffering large downloads; native `downloadURL` is available only when authentication does not require custom headers. This filesystem protocol is independent from the temporary encrypted file-sharing utility and from WebTTY E2E payload encryption.
