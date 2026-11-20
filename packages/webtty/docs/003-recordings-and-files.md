# Read WebTTY recordings and files

Use the server's advertised replay or filesystem endpoint and the appropriate scoped credential.

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

await fs.writeFile("/notes/status.txt", "Ready\n");
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

## Shared filesystem backend

`WebTTYFileSystem` and its existing exports remain available. The implementation now lives in `@rstreamlabs/filesystem`, which also exports `WebDAVFileSystem` and the transport-independent `FileSystemBackend` interface. Existing WebTTY write helpers and configuration are preserved. New read clients can use `readStream` to avoid buffering large downloads; native `downloadURL` is available only when authentication does not require custom headers. This filesystem protocol is independent from the temporary encrypted file-sharing utility and from WebTTY E2E payload encryption.
