# @rstreamlabs/filesystem

## 0.2.0

### Minor Changes

- Add a shared read-only WebRTC filesystem transport with server discovery, real browser/Node DataChannels, rstream ICE configuration, bounded streaming, authorization renewal and ICE restart. Keep WebDAV writes unchanged when selected and reject every write in WebRTC mode. WebTTY uses the common client while preserving its public errors. Expose fs_backend in inventory and add reusable picker-first browser disk download/progress helpers.

### Patch Changes

- Introduce a shared filesystem backend interface and WebDAV client for the CLI file browser and WebTTY. Preserve WebTTY exports and write APIs while adding streaming reads and native download URLs, with exact filename encoding and cancellation support.
