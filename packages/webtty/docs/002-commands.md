# Run and observe remote commands

Use an authorized WebTTY session for an application-owned command. Choose whether the caller should wait for the result, stream output or return with a bounded execution ID.

## Execute Commands

For non-interactive agent workflows, use `runWebTTYCommand` or
`executeWebTTYCommand`. Both open a WebTTY session, collect stdout and stderr,
and resolve when the remote command exits.

```ts
import { runWebTTYCommand } from "@rstreamlabs/webtty";

const result = await runWebTTYCommand(
  { url: "wss://host.example.t.rstream.io?rstream.token=<token>" },
  "sh",
  ["-lc", "docker ps --format '{{.Names}}'"],
  { timeoutMs: 30_000 },
);

if (!result.success) {
  throw new Error(
    result.stderr || `Remote command exited with ${result.exitCode}`,
  );
}

console.log(result.stdout);
```

Use `openWebTTYCommand` when you need live control over a running command. It
returns a command object with replayable stdout/stderr, ordered log iteration,
stdin writes, EOF handling, `wait()`, and explicit `kill()`/`terminate()`.

`terminate({ signal?, timeoutMs? })` sends a protocol termination request and
waits for the native process result, including final stdout/stderr. `kill()` is
an alias with the same semantics. The default confirmation wait is 65 seconds.
`wait()` and `exitCode` retain the native result, including a natural exit that
races with termination. Repeated requests do not restart termination.

Missing native support rejects the operation without disconnecting. An aborted
or timed-out confirmation wait leaves the remote result unknown and the reader
connected; `wait()` can still observe a later native result. Use `disconnect()`
when the application is finished with that reader. No local failure invents an
exit code. Managed clients must also check the Engine's `explicit_termination`
capability; an older relay can ignore a request even if a new native server
advertises support, in which case confirmation times out.

Low-level `WebTTY.canTerminate()` exposes native support after `onConnect`.
`WebTTY.requestTermination()` queues the request; only `onComplete` confirms its
outcome. Managed control permissions still apply independently of support.

Command output capture is bounded to 8 MiB by default (`maxOutputBytes` can set
another positive byte limit), and at most 32,768 nonempty chunks. Exceeding either
limit raises `WebTTYCommandOutputLimitError` on output readers and requests
termination. Further output is discarded while the bounded confirmation wait
continues; `wait()` still reports a native result if one arrives. If termination
cannot be confirmed, the command reader is disconnected with an unknown result.
Use the low-level `WebTTY` output callbacks for continuous streaming without
retaining a replayable command output buffer.

```ts
import { openWebTTYCommand } from "@rstreamlabs/webtty";

const command = openWebTTYCommand(
  { url: "wss://host.example.t.rstream.io?rstream.token=<token>" },
  {
    cmdArgs: ["sh", "-lc", "npm test"],
    timeoutMs: 120_000,
  },
);

for await (const entry of command.logs()) {
  process[entry.stream === "stdout" ? "stdout" : "stderr"].write(entry.data);
}

const status = await command.wait();

if (!status.success) {
  throw new Error(`Remote command exited with ${status.exitCode}`);
}
```

Use `WebTTYRemoteExecutor` when the URL is resolved lazily, for example from a
fresh short-lived token. When the WebTTY server is discovered through
`@rstreamlabs/tunnels`, pass the advertised `exec_path` value as `execPath`
instead of assuming `/`.

### Bounded detached execution

Fetch WebTTY capabilities from the same Engine that provides the authenticated
terminal URL, then pass them as `managed.capabilities`. The object returned by
`@rstreamlabs/tunnels`' WebTTY capabilities API is directly compatible.

```ts
const command = openWebTTYCommand(
  {
    url: authenticatedTerminalUrl,
    managed: { capabilities, executionSeconds: 300 },
  },
  { cmdArgs: ["sh", "-c", "run-job"], interactive: false, allocateTty: false },
);
await command.ready();
const executionId = command.managedSessionId;
// Save executionId before releasing the reader.
command.disconnect();
```

The SDK checks the advertised transport and maximum duration before connecting.
`ready()` waits for the relay's confirmation; `managedSessionId` then identifies
the same execution for later session API calls. `ready({ signal })` cancels only
that wait. A missing or zero budget preserves the ordinary connection-bound
lifetime. Detaching does not establish an exit result, and losing the opening
response does not make retrying the command safe.

Use the saved ID to inspect the session or obtain an authorized participant and
Attach grant. No new Open is needed to recover a running command. The original
deadline remains unchanged. This does not add restart survival or an output
cursor; historical output still depends on recording and retention permissions.

For any managed connection, including Attach, `managed.capabilities` also gates
explicit termination: both Engine and native server support are required. An
Attach without this capability snapshot cannot send Terminate. Current control
authority is still checked by the Engine for every request.

Omitting `executionSeconds` or setting it to zero keeps the ordinary connection
lifetime, including when the Engine reports `managed_protocol: false`. Supplying
that capability snapshot still prevents unsupported termination requests.

### Managed session attach

Engine-managed sessions are joined with a WebTTY `Attach` message. The attach
grant is obtained from the control-plane API, then sent as the first protobuf
message on the terminal stream. Terminal input and output stay on the WebTTY
data path. The Engine participant stream uses WebSocket, including when the
original execution used WebTransport. Check the session's `live.attachable`
state before requesting an Attach grant and use its advertised participant
transport.

```ts
import { WebTTY } from "@rstreamlabs/webtty";

const session = new WebTTY({
  managed: { capabilities },
  attach: {
    attachGrant,
    capabilities: ["read_stream", "request_control"],
    participantId,
    sessionId,
  },
  url: participantStreamUrl,
});

session.connect();
```
