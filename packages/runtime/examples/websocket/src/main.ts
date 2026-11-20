// See LICENSE file in the project root for license information.

import { Client } from "@rstreamlabs/runtime";
import { WebSocketServer } from "ws";
import http from "node:http";

const client = Client.fromEnv();
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  const control = await client.connect({ signal: cancellation.signal });
  const closing: { promise?: Promise<void> } = {};
  const closeControl = () => (closing.promise ??= control.close());
  const stopControl = () => void closeControl().catch(() => undefined);
  cancellation.signal.addEventListener("abort", stopControl, { once: true });
  try {
    cancellation.signal.throwIfAborted();
    const tunnel = await control.createTunnel({
      httpVersion: "http/1.1",
      protocol: "http",
      publish: true,
    });
    cancellation.signal.removeEventListener("abort", stopControl);
    const server = http.createServer();
    const sockets = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      sockets.handleUpgrade(request, socket, head, (connection) => {
        connection.send("connected through rstream");
      });
    });
    try {
      cancellation.signal.throwIfAborted();
      const address = new URL(await tunnel.forwardingAddress());
      address.protocol = "wss:";
      console.log("WebSocket address:", address.toString());
      await tunnel.serve(server, { signal: cancellation.signal });
    } finally {
      for (const connection of sockets.clients) connection.terminate();
      sockets.close();
      server.close();
      await tunnel.close();
    }
  } finally {
    cancellation.signal.removeEventListener("abort", stopControl);
    await closeControl();
  }
} catch (error) {
  if (!cancellation.signal.aborted) throw error;
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await client.close();
}
