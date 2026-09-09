# `@rstreamlabs/utils`

Small shared utilities used by rstream packages and applications.

This package is intentionally narrow. It contains code that is useful across
apps but does not belong to a product-specific SDK surface.

## Install

```sh
npm install @rstreamlabs/utils
```

## Public IP Discovery

`getPublicIP()` uses `RTCPeerConnection` and a STUN server to discover server
reflexive IPv4 and IPv6 candidates in browser-compatible runtimes.

```ts
import { getPublicIP } from "@rstreamlabs/utils";

const result = await getPublicIP();

if ("error" in result) {
  console.error(result.error);
} else {
  console.log(result.ipv4);
  console.log(result.ipv6);
}
```

Pass a custom STUN server when the default public Google STUN endpoint is not
appropriate:

```ts
const result = await getPublicIP("stun:stun.example.net:3478");
```

The function returns structured partial errors because IPv4 and IPv6 discovery
can fail independently.

## File Sharing Client Protocol

The hosted rstream file-sharing tool uses browser-side WebCrypto for access
challenges and download decryption. The client protocol helpers are exported
from the `@rstreamlabs/utils/file-sharing` subpath so they stay out of the
generic root utility surface.

```ts
import { createFileSharingAccessChallenge } from "@rstreamlabs/utils/file-sharing";
import { decodeFileSharingKey } from "@rstreamlabs/utils/file-sharing";
import { FileSharingDownloadStream } from "@rstreamlabs/utils/file-sharing";
import { importFileSharingAesCtrKey } from "@rstreamlabs/utils/file-sharing";

const keyBytes = decodeFileSharingKey(location.hash.slice(1));
const challenge = await createFileSharingAccessChallenge({ key: keyBytes });
const response = await fetch(
  `/api/tools/file-sharing/id/download?challenge=${challenge}`,
);
const responseBody = response.body;
const key = await importFileSharingAesCtrKey({ key: keyBytes });

if (responseBody === null) {
  throw new Error("Download response did not include a body.");
}

await responseBody
  .pipeThrough(new FileSharingDownloadStream({ key }))
  .pipeTo(writable);
```

## Runtime Notes

`getPublicIP()` requires `RTCPeerConnection`. It is intended for browser-like
environments, not plain Node.js processes.

The file-sharing helpers require WebCrypto and Web Streams. They are intended
for browser-compatible runtimes and for tests that provide `crypto.subtle`.

## Development

```sh
npm --workspace @rstreamlabs/utils run type-check
npm --workspace @rstreamlabs/utils run lint
npm --workspace @rstreamlabs/utils run test
npm --workspace @rstreamlabs/utils run build
```

## Streaming browser downloads

Import `canSaveDownload`, `createDownloadDestination`, `createDownloadProgress` or `saveDownload` from `@rstreamlabs/utils/download`. Call `saveDownload(filename, sourceFactory, { signal, onProgress })` directly from a user click: it opens the file picker before awaiting network work, then pipes the source to disk with backpressure. Picker cancellation never starts a transfer; source errors and aborts close the destination. Callers choose the fallback when the disk-save API is unavailable. The module does not buffer a whole file or import encryption code.
