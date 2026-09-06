// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http2 = require("node:http2");
const path = require("node:path");
const test = require("node:test");
const { WebSocketServer } = require("ws");
const {
  nodeWebSocketFactory,
  runWebTTYCommand,
} = require("../../dist/node.js");
const Message = require("protobufjs")
  .loadSync(path.join(__dirname, "../../protobuf/webtty.proto"))
  .lookupType("rstream.webtty.protobuf.Message");

async function fixture(run, onMessage, onUpgrade) {
  const directory = process.env.WEBTTY_NODE_TLS_FIXTURE;
  const server = http2.createSecureServer({
    key: fs.readFileSync(path.join(directory, "key.pem")),
    cert: fs.readFileSync(path.join(directory, "cert.pem")),
    allowHTTP1: true,
    settings: { enableConnectProtocol: true },
  });
  const sockets = new Set();
  const protocols = [];
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("stream", (stream) => {
    protocols.push("h2");
    stream.close();
  });
  const wsServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    protocols.push(request.httpVersion);
    socket.on("error", () => {});
    if (onUpgrade) return onUpgrade(socket);
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      ws.on("error", () => {});
      ws.on("message", (bytes) => onMessage(ws, Message.decode(bytes)));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = {
    url: `wss://127.0.0.1:${server.address().port}/`,
    webSocketFactory: nodeWebSocketFactory,
    sendHeartbeat: false,
  };
  try {
    await run(client, protocols);
  } finally {
    for (const ws of wsServer.clients) ws.terminate();
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      new Promise((resolve) => wsServer.close(resolve)),
      new Promise((resolve) => server.close(resolve)),
    ]);
  }
}

function send(ws, message) {
  ws.send(Message.encode(message).finish());
}

test(
  "concurrent commands use HTTP/1.1 with an HTTP/2 capable endpoint without changing global WebSocket",
  { timeout: 5000 },
  async () => {
    const original = global.WebSocket;
    await fixture(
      async (client, protocols) => {
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            runWebTTYCommand(client, "echo", [`unique-${index}`], {
              timeoutMs: 2000,
            }),
          ),
        );
        results.forEach((result, index) =>
          assert.deepEqual(result, {
            stdout: `unique-${index}`,
            stderr: "warning",
            exitCode: 7,
            success: false,
          }),
        );
        assert.deepEqual(protocols, Array(8).fill("1.1"));
        assert.equal(global.WebSocket, original);
      },
      (ws, message) => {
        if (!message.open) return;
        send(ws, { ack: {} });
        send(ws, {
          data: { data: Buffer.from(message.open.config.cmdArgs[1]), type: 1 },
        });
        send(ws, { data: { data: Buffer.from("warning"), type: 2 } });
        send(ws, { close: { returnCode: 7 } });
      },
    );
  },
);

test(
  "cancelling a pending TLS WebSocket upgrade closes the socket without an unhandled error",
  { timeout: 5000 },
  async () => {
    let accepted;
    const upgraded = new Promise((resolve) => {
      accepted = resolve;
    });
    await fixture(
      async (client) => {
        const controller = new AbortController();
        const result = runWebTTYCommand(client, "never-executed", [], {
          signal: controller.signal,
          timeoutMs: 2000,
        });
        const rejected = assert.rejects(result, /abort|cancel/i);
        const socket = await upgraded;
        const closed = new Promise((resolve) => socket.once("close", resolve));
        controller.abort();
        await Promise.all([rejected, closed]);
      },
      undefined,
      accepted,
    );
  },
);

test(
  "oversized WebSocket frames fail within the configured incoming limit",
  { timeout: 5000 },
  async () => {
    await fixture(
      async (client) => {
        await assert.rejects(
          runWebTTYCommand(
            { ...client, maxMessageSize: 1024 },
            "oversize",
            [],
            { timeoutMs: 2000 },
          ),
          /WebSocket|closed/i,
        );
      },
      (ws, message) => {
        if (!message.open) return;
        send(ws, { ack: {} });
        send(ws, { data: { data: Buffer.alloc(2048), type: 1 } });
      },
    );
  },
);

test(
  "an abruptly closed real WebSocket fails an active command",
  { timeout: 5000 },
  async () => {
    await fixture(
      async (client) => {
        await assert.rejects(
          runWebTTYCommand(client, "interrupted", [], { timeoutMs: 2000 }),
          /closed/i,
        );
      },
      (ws, message) => {
        if (!message.open) return;
        send(ws, { ack: {} });
        ws.terminate();
      },
    );
  },
);
