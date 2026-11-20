# Own the Node.js runtime and its streams

Create a client and control channel with the application that owns them.
Start the service once, keep its tunnels open while it accepts, and
close their resources when the service stops.

| Resource                     | What to close                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Client                       | `await client.close()` releases its Engine HTTP pools.                                    |
| Control channel              | `await ctrl.close()` closes its native runtime connection and tunnels.                    |
| Tunnel                       | `await tunnel.close()` stops its admission and releases the tunnel.                       |
| Active stream or HTTP server | End or destroy your streams, and close the service's HTTP server and upgrade connections. |

Use an `AbortSignal` to cancel native connection setup and stop accepting
new streams. Managed discovery and token issuance use the Engine HTTP
client's own timeouts. After a stream is returned, close it through its
own lifecycle. The [HTTP program](../../packages/runtime/examples/http-server/src/main.ts)
handles both SIGINT and SIGTERM. It closes the control channel if
interrupted during tunnel creation.

## Recover after loss of control

A missed heartbeat or unexpected EOF stops new admissions. A duplex
already returned by `accept()` can still exchange data on its own
connection. Treat its EOF or error as the end of that exchange.
`ctrl.done()` tells the owner when the control path has ended.

The application decides if and when to create another control channel
and tunnel. Put that logic outside request handling. Close owners from
the old generation, retry transient problems with bounded backoff and
surface authentication or configuration errors. Explicit tunnel closure
or Engine revocation can terminate active streams. If you need to drain
them first, keep their owning tasks alive and bound the drain.

Persist a requested stable hostname if clients must keep using the same
published address. A new tunnel with an automatically assigned address
can receive a different one.
