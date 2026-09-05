# @rstreamlabs/filesystem

A small, terminal-independent filesystem client. `FileSystemBackend` separates listing, metadata, streamed reads and browser download URLs from a particular transport. `WebDAVFileSystem` is the first implementation. Encryption and transport capabilities must be negotiated separately; this package does not claim end-to-end encryption or peer-to-peer transfer.

```ts
import { WebDAVFileSystem } from "@rstreamlabs/filesystem";

const files = new WebDAVFileSystem({ url: "https://files.example", fsPath: "/fs" });
const entries = await files.list("/");
const stream = await files.readStream("/backup.tar.zst", { range: "bytes=1048576-" });
const download = await files.downloadURL("/backup.tar.zst");
```

Paths are decoded, root-relative filesystem names. The client encodes each segment; callers must not pre-encode names. `list` includes the directory's own response; `readdir` omits it. Request options accept `AbortSignal`. A requested range requires HTTP 206; an ignored range fails instead of returning an unexpected full file. Error response reads are capped at 4096 bytes and cancelled. `readBytes` and `readFile` buffer the complete file; use `readStream` for large files. Browser download URLs use the browser's credentials and cannot carry custom Authorization headers; header-authenticated clients must stream the response.

The existing write, mkdir, copy, move and remove helpers remain available for writable WebDAV servers. A read-only server rejects these operations. `@rstreamlabs/webtty` retains its previous `WebTTYFileSystem` exports as compatibility adapters.

## Validation

Run `npm run build --workspace @rstreamlabs/filesystem`, then its `test`, `type-check` and `lint` scripts from the monorepo root.
