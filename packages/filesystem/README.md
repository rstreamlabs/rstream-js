# @rstreamlabs/filesystem

A small, terminal-independent filesystem client. `FileSystemBackend` separates listing, metadata, streamed reads and browser download URLs from a particular transport. `RemoteFileSystem` discovers the server-selected WebDAV or WebRTC backend. `WebDAVFileSystem` and `WebRTCFileSystem` explicitly select one. WebRTC uses a real DataChannel for read responses; application-level E2E encryption/key management is not included.

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

Paths are decoded, root-relative filesystem names. The client encodes each segment; callers must not pre-encode names. `list` includes the directory's own response; `readdir` omits it. Request options accept `AbortSignal`. A requested range requires HTTP 206; an ignored range fails instead of returning an unexpected full file. Error response reads are capped at 4096 bytes and cancelled. `readBytes` and `readFile` buffer the complete file; use `readStream` for large files. Browser download URLs use the browser's credentials and cannot carry custom Authorization headers; header-authenticated clients must stream the response.

The existing write, mkdir, copy, move and remove helpers remain available for writable WebDAV servers. A read-only server rejects these operations. `@rstreamlabs/webtty` retains its previous `WebTTYFileSystem` exports as compatibility adapters.

## Validation

Run `npm run build --workspace @rstreamlabs/filesystem`, then its `test`, `type-check` and `lint` scripts from the monorepo root.

## WebRTC

`WebTTYFileSystem` uses the same automatic transport and preserves its public error class. Select WebRTC on the server with `rstream files --backend webrtc` or `webtty server --fs-root ./exports --fs-backend webrtc`. List/stat/read/range and standalone `archiveStream` use the same operations over a Pion-compatible channel. WebTTY does not itself expose an archive endpoint. All writes return 403 in WebRTC mode, including recursive mkdir of the root; no write fallback is attempted.

Browsers use native RTCPeerConnection. Node uses optional `@roamhq/wrtc` or the `rtc.createPeerConnection` factory supplied by the caller; missing support raises a clear error. Both CommonJS and ESM exports are available. Native provider platform support must be qualified by the consumer's release CI. Signaling uses the provided fetch/auth headers and server-provided rstream ICE servers; no external public STUN is hard-coded.

A response owns a peer until its stream is read or cancelled. Receive queues are bounded; cancellation propagates to the sender. Authenticated leases and ICE restarts retain authorization and refresh TURN credentials for long downloads. Truncated responses fail instead of reporting success. Native `downloadURL` links remain HTTP compatibility reads; for WebRTC browser data use `readStream` with `saveDownload` from `@rstreamlabs/utils/download`.

For real Go/Node tests, build the Go `filesystem/rtc/testdata/server` fixture and set `RSTREAM_FILES_E2E_SERVER` to its absolute path, then run `npm run test:e2e --workspace @rstreamlabs/filesystem`. This suite requires the native provider and never skips missing dependencies. It verifies direct/forced TURN, files/WebTTY, hash/range parity, write errors, cancellation and ICE restart while transferring.
