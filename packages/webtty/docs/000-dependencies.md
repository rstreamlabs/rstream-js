# Node transport dependency baseline

The Node WebTTY transport requires `ws` 8.23.0 or newer in the existing 8.x
line. This release [bounds automatic Pong responses](https://github.com/websockets/ws/releases/tag/8.23.0)
when a peer floods Ping frames. Keep its default limit enabled; the SDK also
retains bounded handshake, message size and shutdown behavior.

`test/node-autopong.test.cjs` drives the public `nodeWebSocketFactory` with a
local RFC 6455 peer sending a finite burst of valid Ping frames. It checks
bounded buffered output and termination within a deadline. It fails with ws
8.22.1 and passes with 8.23.0. The separate Node WebSocket TLS/runtime suite
covers certificate trust, concurrency, payload limits and cancellation.

Run the package tests and Node runtime suite after dependency changes, then
run the repository's dependency audit. A clean high/critical audit does not
replace behavioral tests or imply that every development dependency has no
advisories. The recorded maintenance audit uses no expired exception.
