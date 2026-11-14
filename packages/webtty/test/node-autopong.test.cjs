// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const http = require("node:http");
const test = require("node:test");
const { nodeWebSocketFactory } = require("../dist/node.js");

test(
  "Node WebTTY bounds automatic Pong responses to a flooding peer",
  { timeout: 5000 },
  async (t) => {
    const server = http.createServer();
    const connections = new Set();
    server.on("connection", (connection) => {
      connections.add(connection);
      connection.on("error", () => {});
      connection.on("close", () => connections.delete(connection));
    });
    server.on("upgrade", (request, connection) => {
      const key = request.headers["sec-websocket-key"];
      assert.equal(typeof key, "string");
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      connection.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
          accept +
          "\r\n\r\n",
      );
      // One wire burst keeps Pong write callbacks pending while valid Pings arrive.
      connection.write(
        Buffer.concat(
          Array.from({ length: 256 }, () =>
            Buffer.concat([Buffer.from([0x89, 125]), Buffer.alloc(125)]),
          ),
        ),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const socket = nodeWebSocketFactory(
      `ws://127.0.0.1:${server.address().port}/`,
      { maxMessageSize: 1024 },
    );
    t.after(async () => {
      socket.terminate();
      for (const connection of connections) connection.destroy();
      await new Promise((resolve) => server.close(resolve));
    });
    const [code] = await once(socket, "close", {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(code, 1006);
    assert.ok(
      socket.bufferedAmount <= 60 * 131,
      `unbounded Pong queue: ${socket.bufferedAmount}`,
    );
  },
);
