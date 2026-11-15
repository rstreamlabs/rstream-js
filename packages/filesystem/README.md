# @rstreamlabs/filesystem

Access files shared by a rstream filesystem server from a browser or Node.js application, without opening a terminal. The client can list directories, inspect metadata, stream downloads and perform the write operations allowed by the server.

The server owns filesystem permissions and selects the available WebDAV or WebRTC backend. `RemoteFileSystem` discovers that choice; `WebDAVFileSystem` and `WebRTCFileSystem` select a backend explicitly. `FileSystemBackend` is the common application interface.

## Install and connect

```sh
npm install @rstreamlabs/filesystem
```

Use an existing filesystem endpoint and the authentication required by its owner. A WebTTY filesystem sidecar commonly uses `/fs`; supply the actual server path with `fsPath`. This package is a client: it does not start a file server or grant access to a path.

```ts
import { RemoteFileSystem } from "@rstreamlabs/filesystem";

const files = new RemoteFileSystem({
  url: "https://files.example",
  fsPath: "/fs",
});
const entries = await files.list("/");
const stream = await files.readStream("/backup.tar.zst", {
  range: "bytes=1048576-",
});
const download = await files.downloadURL("/backup.tar.zst");
```

The example returns directory metadata, a readable download stream and a browser download URL. Consume or cancel each returned stream so its transport resources can be released.

## Configuration

| Option        | Purpose                                                                               |
| ------------- | ------------------------------------------------------------------------------------- |
| `url`         | Owner endpoint, or a URL provider when a fresh authorized URL is needed.              |
| `fsPath`      | Filesystem endpoint path; defaults to `/fs`. Match the owner configuration.           |
| `authToken`   | A scoped bearer token when the endpoint uses token authentication.                    |
| `headers`     | Additional HTTP headers for the owner.                                                |
| `fetch`       | A supplied fetch implementation, for example to integrate application authentication. |
| `archivePath` | Archive endpoint path when the owner exposes one.                                     |
| `backend`     | `auto`, `webdav` or `webrtc`; automatic selection follows server discovery.           |
| `rtc`         | Native peer-connection factory or other supported WebRTC options.                     |

Keep long-lived application secrets on the backend. Pass only the credential authorized for this filesystem session to a browser client.

## Choose an operation

| Operation                                   | Behavior or constraint                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`, `readdir`                           | List directory entries; `list` includes the directory's own response and `readdir` omits it.                                                               |
| `stat`                                      | Read metadata, including a revision when the owner can provide one.                                                                                        |
| `readStream`                                | Stream file contents with bounded buffering; preferred for large files.                                                                                    |
| `readBytes`, `readFile`                     | Buffer the complete file in memory.                                                                                                                        |
| `downloadURL`                               | Use a browser-native download with browser credentials; custom Authorization headers cannot be attached. Header-authenticated clients must stream instead. |
| Write, mkdir, copy, move and remove helpers | Available when the WebDAV owner allows writes; a read-only server rejects them.                                                                            |

Paths are decoded, root-relative filesystem names. The client encodes each segment; callers must not pre-encode them. Request options accept `AbortSignal`. A requested range requires HTTP 206; a server that ignores the range causes an error rather than an unexpected full download. Error-response reads are capped at 4096 bytes and cancelled.

`@rstreamlabs/webtty` also exports `WebTTYFileSystem` compatibility adapters. The filesystem interface itself is independent of terminal sessions.

## Guarded transfers

`stat` and `list` expose an optional `revision`. An absent revision is unknown; do not infer one from size or modification time. `readStream(path, { expectedRevision })` binds a download to that revision. These streams still need to be consumed and their digest checked by the application when it requires end-to-end content validation.

For supported WebDAV owners, `upload(path, body, options)` sends a complete body with bounded-memory streaming, its known byte count and SHA-256, and an explicit precondition. Supply `expectedRevision: null` to create only, or the current revision to replace it. Retain the upload ID before sending:

```ts
const receipt = await files.upload("/backup.tar.zst", bodyStream, {
  id: persistedUploadId,
  sizeBytes: fileSizeAsDecimalString,
  sha256: expectedSHA256,
  expectedRevision: null,
});
if (receipt.state !== "committed") {
  // Preserve rejected, interrupted or uncertain outcomes for reconciliation.
  console.log(receipt.state, receipt.status);
}
const sameAttempt = await files.getUploadReceipt(
  "/backup.tar.zst",
  persistedUploadId,
);
```

The owner validates content before atomic publication. The receipt survives a client disconnect, owner restart, later replacement or removal. `getUploadReceipt` only reads; it never resubmits content. Reusing an ID with the same parameters returns the same outcome, while different parameters conflict. A missing response is not proof of failure; recover the ID before deciding whether to submit a new attempt. An interrupted attempt needs a new explicit ID. `uncertain` is a terminal outcome whose physical effect could not be established. The UTC receipt timestamps are the owner's wall clock.

Use `removeIfRevision(path, revision)` for guarded deletion. Guarded mutations use the existing HTTP transport with an explicit PATCH action; older owners reject it rather than ignoring conditional headers. No retry, unconditional fallback or WebRTC-to-WebDAV write fallback is performed. Current permissions still apply to receipt reads and mutations. Server support and admission are distinct: durable receipt storage is bounded and can refuse a new attempt. Windows owners currently support conditional writes but not durable upload receipts. See the [owner protocol and retention rules](https://github.com/rstreamlabs/rstream-go/blob/main/docs/010-file-sharing.md#recoverable-uploads).

## WebRTC

Read responses use a real DataChannel. This package does not provide application-level end-to-end encryption or key management.

`WebTTYFileSystem` uses the same automatic transport and preserves its public error class. Select WebRTC on the server with `rstream files --backend webrtc` or `webtty server --fs-root ./exports --fs-backend webrtc`. List/stat/read/range and standalone `archiveStream` use the same operations over a Pion-compatible channel. WebTTY does not itself expose an archive endpoint. All writes return 403 in WebRTC mode, including recursive mkdir of the root; no write fallback is attempted.

Browsers use native RTCPeerConnection. Node uses optional `@roamhq/wrtc` or the `rtc.createPeerConnection` factory supplied by the caller; missing support raises a clear error. Both CommonJS and ESM exports are available. Native provider platform support must be qualified by the consumer's release CI. Signaling uses the provided fetch/auth headers and server-provided rstream ICE servers; no external public STUN is hard-coded.

A response owns a peer until its stream is read or cancelled. Receive queues are bounded; cancellation propagates to the sender. Authenticated leases and ICE restarts retain authorization and refresh TURN credentials for long downloads. Truncated responses fail instead of reporting success. Native `downloadURL` links remain HTTP compatibility reads; for WebRTC browser data use `readStream` with `saveDownload` from `@rstreamlabs/utils/download`.

For real Go/Node tests, build the Go `filesystem/rtc/testdata/server` fixture and set `RSTREAM_FILES_E2E_SERVER` to its absolute path, then run `npm run test:e2e --workspace @rstreamlabs/filesystem`. This suite requires the native provider and never skips missing dependencies. It verifies direct/forced TURN, files/WebTTY, hash/range parity, write errors, cancellation and ICE restart while transferring.

## Validation

Run `npm run build --workspace @rstreamlabs/filesystem`, then its `test`, `type-check` and `lint` scripts from the monorepo root.
