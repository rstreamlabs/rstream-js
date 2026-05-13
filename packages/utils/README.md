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

## Runtime Notes

`getPublicIP()` requires `RTCPeerConnection`. It is intended for browser-like
environments, not plain Node.js processes.

## Development

```sh
npm --workspace @rstreamlabs/utils run type-check
npm --workspace @rstreamlabs/utils run lint
npm --workspace @rstreamlabs/utils run build
```
