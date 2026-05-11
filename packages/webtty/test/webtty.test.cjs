// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const path = require("node:path");
const protobuf = require("protobufjs");
const test = require("node:test");

const { WebTTY } = require("../dist/index.js");

const root = protobuf.loadSync(
  path.join(__dirname, "../protobuf/webtty.proto"),
);
const Message = root.lookupType("rstream.webtty.protobuf.Message");

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.binaryType = "";
    this.closeCalls = 0;
    this.listeners = new Map();
    this.sent = [];
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== callback),
    );
  }
  send(payload) {
    this.sent.push(Buffer.from(payload));
  }
  close() {
    this.closeCalls += 1;
  }
  dispatch(type, event = {}) {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(event);
    }
  }
}

function encode(payload) {
  return Message.encode(Message.create(payload)).finish();
}

function decode(payload) {
  return Message.decode(payload);
}

function withFakeWebSocket(callback) {
  const original = global.WebSocket;
  FakeWebSocket.instances = [];
  global.WebSocket = FakeWebSocket;
  try {
    callback();
  } finally {
    global.WebSocket = original;
  }
}

function connect(client) {
  client.connect();
  const ws = FakeWebSocket.instances[0];
  ws.dispatch("open");
  ws.dispatch("message", { data: encode({ ack: {} }) });
  return ws;
}

test("WebTTY opens a protobuf session and sends interactive client messages", () => {
  withFakeWebSocket(() => {
    const connected = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      {
        cmdArgs: ["bash", "-lc", "id"],
        envVars: [{ key: "TERM", value: "xterm-256color" }],
        username: "alice",
        workdir: "/srv/app",
      },
      { onConnect: () => connected.push(true) },
    );
    const ws = connect(client);
    assert.equal(ws.url, "wss://terminal.example.test/session");
    assert.equal(ws.binaryType, "arraybuffer");
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.cmdArgs, ["bash", "-lc", "id"]);
    assert.deepEqual(
      open.open.config.envVars.map((entry) => entry.toJSON()),
      [{ key: "TERM", value: "xterm-256color" }],
    );
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(open.open.config.options.allocateTty, true);
    assert.equal(open.open.config.options.sendHeartbeat, false);
    assert.equal(open.open.config.username.name, "alice");
    assert.equal(open.open.config.workdir.value, "/srv/app");
    assert.deepEqual(connected, [true]);
    client.writeStdin(new Uint8Array([65, 66]));
    assert.deepEqual(Array.from(decode(ws.sent[1]).data.data), [65, 66]);
    client.closeStdin();
    assert.ok(decode(ws.sent[2]).data.eos);
    client.resize(24, 80, 800, 600);
    assert.deepEqual(decode(ws.sent[3]).parameter.terminalSize.toJSON(), {
      col: 80,
      row: 24,
      xpixel: 800,
      ypixel: 600,
    });
  });
});

test("WebTTY ignores explicit undefined options when applying defaults", () => {
  withFakeWebSocket(() => {
    const client = new WebTTY(
      {
        heartbeatIntervalMs: undefined,
        sendHeartbeat: undefined,
        url: "wss://terminal.example.test/session",
      },
      {
        allocateTty: undefined,
        envVars: undefined,
        interactive: undefined,
      },
    );
    const ws = connect(client);
    const open = decode(ws.sent[0]);
    assert.deepEqual(open.open.config.envVars, []);
    assert.equal(open.open.config.options.interactive, true);
    assert.equal(open.open.config.options.allocateTty, true);
    assert.equal(open.open.config.options.sendHeartbeat, true);
    client.disconnect();
  });
});

test("WebTTY dispatches stdout stderr EOS and remote close events exactly once", () => {
  withFakeWebSocket(() => {
    const events = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      {
        onComplete: (code) => events.push(["complete", code]),
        onStderr: (chunk) =>
          events.push(["stderr", Buffer.from(chunk).toString()]),
        onStderrEos: () => events.push(["stderr-eos"]),
        onStdout: (chunk) =>
          events.push(["stdout", Buffer.from(chunk).toString()]),
        onStdoutEos: () => events.push(["stdout-eos"]),
      },
    );
    const ws = connect(client);
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("out"), type: 1 } }),
    });
    ws.dispatch("message", { data: encode({ data: { eos: {}, type: 1 } }) });
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("err"), type: 2 } }),
    });
    ws.dispatch("message", { data: encode({ data: { eos: {}, type: 2 } }) });
    ws.dispatch("message", { data: encode({ close: { returnCode: 7 } }) });
    ws.dispatch("close");
    assert.deepEqual(events, [
      ["stdout", "out"],
      ["stdout-eos"],
      ["stderr", "err"],
      ["stderr-eos"],
      ["complete", 7],
    ]);
    assert.equal(ws.closeCalls, 1);
  });
});

test("WebTTY fails closed for invalid states and malformed server messages", () => {
  withFakeWebSocket(() => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      { allocateTty: false, interactive: false },
      { onError: (error) => errors.push(error) },
    );
    assert.throws(
      () => client.writeStdin(new Uint8Array([1])),
      /Invalid state/,
    );
    const ws = connect(client);
    assert.throws(() => client.writeStdin(new Uint8Array([1])), /STDIN/);
    assert.throws(() => client.closeStdin(), /STDIN/);
    assert.throws(() => client.resize(24, 80), /Resize/);
    ws.dispatch("message", { data: Buffer.from([255]) });
    assert.match(errors[0], /^Failed to decode message:/);
  });
});

test("WebTTY closes unexpected pre-ACK data instead of processing it", () => {
  withFakeWebSocket(() => {
    const errors = [];
    const client = new WebTTY(
      { sendHeartbeat: false, url: "wss://terminal.example.test/session" },
      undefined,
      { onError: (error) => errors.push(error) },
    );
    client.connect();
    const ws = FakeWebSocket.instances[0];
    ws.dispatch("open");
    ws.dispatch("message", {
      data: encode({ data: { data: Buffer.from("early"), type: 1 } }),
    });
    assert.deepEqual(errors, ["Unexpected data message."]);
    assert.equal(ws.closeCalls, 1);
  });
});
