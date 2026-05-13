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
const ctrl = await client.connect();
const tunnel = await ctrl.createTunnel({
  auth: { rstream: true, token: true },
  httpVersion: "http/1.1",
  protocol: "http",
  publish: true,
});
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(os.hostname());
});
const shutdown = async () => {
  await Promise.allSettled([closeServer(server), tunnel.close(), ctrl.close()]);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
try {
  console.log("Server accessible at:", await tunnel.forwardingAddress());
  await tunnel.serve(server);
} finally {
  await shutdown();
}
