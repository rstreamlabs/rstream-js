// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const protobuf = require("protobufjs");
const { ControlChannel } = require("../../dist/index.js");

const root = new protobuf.Root();
root.resolvePath = (_origin, target) =>
  target.startsWith("google/protobuf/")
    ? path.join(__dirname, "../../../../node_modules/protobufjs", target)
    : path.join(__dirname, "../../protobuf", target);
root.loadSync("rstream.proto");
const Message = root.lookupType("rstream.io_rstrm.protobuf.Message");

class ControlledSocket extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.callbacks = [];
    this.holdWrites = false;
    this.destroyed = false;
  }
  write(frame, callback) {
    this.messages.push(Message.decode(frame.subarray(4)));
    if (this.holdWrites) this.callbacks.push(callback);
    else queueMicrotask(() => callback());
    this.emit("write");
    return true;
  }
  async written(count) {
    while (this.messages.length < count)
      await new Promise((resolve) => this.once("write", resolve));
    return this.messages[count - 1];
  }
  receive(message) {
    const body = Message.encode(Message.create(message)).finish();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    this.emit("data", Buffer.concat([header, body]));
  }
  destroy() {
    this.destroyed = true;
  }
  releaseWrites() {
    for (const callback of this.callbacks.splice(0)) callback();
  }
}

async function main() {
  const operation = process.argv[2];
  assert.ok(operation === "create" || operation === "close");
  const socket = new ControlledSocket();
  const control = new ControlChannel(socket, {
    heartbeat: false,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 0,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    openProxyConnection: async () => {
      throw new Error("unexpected proxy connection");
    },
  });
  const firstTunnel =
    operation === "close"
      ? await (async () => {
          const created = control.createTunnel({
            publish: true,
            protocol: "http",
          });
          const message = await socket.written(1);
          socket.receive({
            openTunnelRsp: {
              requestId: message.openTunnelReq.requestId,
              tunnelProperties: {
                id: { value: "tun-1" },
                type: { value: "bytestream" },
                protocol: { value: "http" },
                publish: { value: true },
                hostname: { value: "app.example.test" },
              },
            },
          });
          return await created;
        })()
      : undefined;
  socket.holdWrites = true;
  const request = firstTunnel
    ? firstTunnel.close()
    : control.createTunnel({ publish: true, protocol: "http" });
  const observed = request.then(
    () => ({ resolved: true }),
    (error) => ({ error }),
  );
  await socket.written(operation === "close" ? 2 : 1);
  socket.receive({ closeControlChannelRsp: {} });
  await control.done();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    socket.callbacks.length,
    1,
    "the request write is still blocked after control loss",
  );
  socket.releaseWrites();
  const outcome = await observed;
  assert.equal(outcome.error?.code, "ERR_RSTREAM_CONTROL_CLOSED");
  await assert.rejects(request, (error) => error === outcome.error);
  assert.equal(control.pendingTunnels.size, 0);
  assert.equal(control.pendingCloses.size, 0);
  assert.equal(socket.destroyed, true);
  assert.equal(socket.messages.length, operation === "close" ? 2 : 1);
  console.log("caller received ERR_RSTREAM_CONTROL_CLOSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
