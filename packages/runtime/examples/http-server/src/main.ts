// See LICENSE file in the project root for license information.

import { Client } from "@rstreamlabs/runtime";
import http from "node:http";
import os from "node:os";

const closeServer = (server: http.Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const client = Client.fromEnv();
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const ctrl = await client.connect({ signal: cancellation.signal });
  const closing: { promise?: Promise<void> } = {};
  const closeControl = () => (closing.promise ??= ctrl.close());
  const stopControl = () => void closeControl().catch(() => undefined);
  cancellation.signal.addEventListener("abort", stopControl, { once: true });
  try {
    cancellation.signal.throwIfAborted();
    const tunnel = await ctrl.createTunnel({
      httpVersion: "http/1.1",
      protocol: "http",
      publish: true,
    });
    cancellation.signal.removeEventListener("abort", stopControl);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(os.hostname());
    });
    try {
      cancellation.signal.throwIfAborted();
      console.log("Server accessible at:", await tunnel.forwardingAddress());
      await tunnel.serve(server, { signal: cancellation.signal });
    } finally {
      if (closing.promise) await closing.promise.catch(() => undefined);
      await Promise.allSettled([closeServer(server), tunnel.close()]);
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
