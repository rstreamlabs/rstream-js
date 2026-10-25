---
"@rstreamlabs/webtty": minor
"@rstreamlabs/react": minor
"@rstreamlabs/tunnels": patch
---

Add capability-gated, bounded detached WebTTY executions with a stable managed session identity. A reader can disconnect and an authorized participant can attach to the same execution without starting the command again.

Explicit termination sends the protocol request and waits for the native process result; disconnect only releases the reader. Preserve the actual exit code and final output, keep unconfirmed results unknown, and bound captured output and termination waits. Older Engine and native capabilities are checked independently of authorization.

React terminals forward attachment and managed execution options and expose the acknowledged session through `onSessionReady`. Unmounting disconnects the reader, and stopping one session leaves other readers active. Tunnel session schemas retain the execution deadline metadata.
