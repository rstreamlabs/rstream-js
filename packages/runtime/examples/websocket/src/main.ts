// See LICENSE file in the project root for license information.

import { Client } from "@rstreamlabs/runtime";
import { WebSocketServer } from "ws";
import http from "node:http";

const ctrl = await Client.fromEnv().connect();
const tunnel = await ctrl.createTunnel({
  httpVersion: "http/1.1",
  protocol: "http",
  publish: true,
});
const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send("connected through rstream");
  });
});
process.once(
  "SIGINT",
  () => void Promise.allSettled([tunnel.close(), ctrl.close()]),
);
process.once(
  "SIGTERM",
  () => void Promise.allSettled([tunnel.close(), ctrl.close()]),
);
console.log(
  "WebSocket server accessible at:",
  await tunnel.forwardingAddress(),
);
await tunnel.serve(server);
