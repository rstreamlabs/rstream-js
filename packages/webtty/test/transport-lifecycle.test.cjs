// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const WebTTY = require("../dist/index.js").WebTTY;
const protobuf = require("protobufjs");
const path = require("node:path");
const Message = protobuf
  .loadSync(path.join(__dirname, "../protobuf/webtty.proto"))
  .lookupType("rstream.webtty.protobuf.Message");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function frame(message) {
  const payload = Message.encode(message).finish();
  const result = Buffer.alloc(4 + payload.byteLength);
  result.writeUInt32BE(payload.byteLength);
  result.set(payload, 4);
  return result;
}

async function withConnection(run, config = {}, sink, execution) {
  const previous = global.WebTransport;
  const state = {
    closed: 0,
    cancelled: 0,
    aborted: 0,
    readCalls: 0,
    sent: [],
    errors: [],
    output: [],
    complete: [],
  };
  const opened = Promise.withResolvers();
  global.WebTransport = class {
    ready = Promise.resolve();
    closed = new Promise(() => {});
    createBidirectionalStream() {
      state.readable = new ReadableStream({
        start(controller) {
          state.controller = controller;
        },
        cancel() {
          state.cancelled += 1;
        },
      });
      const getReader = state.readable.getReader.bind(state.readable);
      state.readable.getReader = () => {
        const reader = getReader();
        const read = reader.read.bind(reader);
        reader.read = () => {
          state.readCalls += 1;
          return read();
        };
        return reader;
      };
      state.writable = new WritableStream({
        write(chunk) {
          state.sent.push(chunk);
          opened.resolve();
          return sink?.(chunk, state.sent.length);
        },
        abort() {
          state.aborted += 1;
        },
      });
      return Promise.resolve({
        readable: state.readable,
        writable: state.writable,
      });
    }
    close() {
      state.closed += 1;
    }
  };
  const client = new WebTTY(
    {
      url: "https://shell.example.test",
      transport: "webtransport",
      sendHeartbeat: false,
      ...config,
    },
    execution,
    {
      onError: (error) => state.errors.push(error),
      onStdout: (bytes) => state.output.push(Buffer.from(bytes).toString()),
      onComplete: (code) => state.complete.push(code),
    },
  );
  try {
    client.connect();
    await opened.promise;
    state.controller.enqueue(frame({ ack: {} }));
    await tick();
    await run(client, state);
  } finally {
    client.disconnect();
    await tick();
    global.WebTransport = previous;
  }
}

test("WebTransport unavailable reports a capability error without WebSocket fallback", async () => {
  const previous = global.WebTransport;
  delete global.WebTransport;
  const errors = [];
  try {
    const client = new WebTTY(
      { url: "https://shell.example.test", transport: "webtransport" },
      undefined,
      { onError: (error) => errors.push(error) },
    );
    client.connect();
    await tick();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /WebTransport is not available/);
  } finally {
    global.WebTransport = previous;
  }
});

test("WebTransport close releases both stream locks and cancels pending reads", async () => {
  await withConnection(async (client, state) => {
    client.disconnect();
    await tick();
    assert.equal(state.closed, 1);
    assert.equal(state.cancelled, 1);
    assert.equal(state.aborted, 1);
    assert.equal(state.readable.locked, false);
    assert.equal(state.writable.locked, false);
  });
});

test("WebTransport rejects an oversized frame from its length header", async () => {
  await withConnection(async (_client, state) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(1024 * 1024 + 1);
    state.controller.enqueue(header);
    await tick();
    assert.equal(state.closed, 1);
    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0], /message.*limit/i);
  });
});

test("WebTransport assembles fragmented and coalesced frames in order", async () => {
  await withConnection(async (_client, state) => {
    const first = frame({ data: { data: Buffer.from("fragmented"), type: 1 } });
    for (const byte of first) state.controller.enqueue(new Uint8Array([byte]));
    state.controller.enqueue(
      Buffer.concat([
        frame({ data: { data: Buffer.from("-coalesced"), type: 1 } }),
        frame({ close: { returnCode: 7 } }),
      ]),
    );
    await tick();
    assert.deepEqual(state.errors, []);
    assert.equal(state.output.join(""), "fragmented-coalesced");
    assert.deepEqual(state.complete, [7]);
  });
});

test("WebTransport drains one-byte outputs and reverse EOS order before close", async () => {
  await withConnection(async (_client, state) => {
    state.controller.enqueue(
      Buffer.concat([
        frame({ data: { data: Buffer.from([1]), type: 1 } }),
        frame({ data: { data: Buffer.from([2]), type: 2 } }),
        frame({ data: { eos: {}, type: 2 } }),
        frame({ data: { eos: {}, type: 1 } }),
        frame({ close: { returnCode: 19 } }),
      ]),
    );
    await tick();
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.output, ["\u0001"]);
    assert.deepEqual(state.complete, [19]);
  });
});

test("WebTransport bounds pending writes and never writes queued data after close", async () => {
  const blocked = Promise.withResolvers();
  await withConnection(
    async (client, state) => {
      for (const _index of Array.from({ length: 16 }).keys()) {
        if (state.closed) break;
        client.writeStdin(new Uint8Array(256));
      }
      await tick();
      try {
        assert.equal(state.closed, 1);
        assert.equal(state.errors.length, 1);
        assert.match(state.errors[0], /buffer.*limit/i);
      } finally {
        blocked.resolve();
      }
      await tick();
      assert.ok(state.sent.length <= 2);
    },
    { maxMessageSize: 512 },
    (_chunk, count) => (count > 1 ? blocked.promise : undefined),
  );
});

test("WebTransport write failure closes the connection once", async () => {
  await withConnection(
    async (client, state) => {
      client.writeStdin(new Uint8Array([1]));
      await tick();
      assert.equal(state.closed, 1);
      assert.equal(state.errors.length, 1);
      assert.match(state.errors[0], /write failed: sink failed/);
      client.disconnect();
      assert.equal(state.closed, 1);
    },
    {},
    (_chunk, count) =>
      count > 1 ? Promise.reject(new Error("sink failed")) : undefined,
  );
});

test("WebTransport stops reading during decryption and drops late output after disconnect", async () => {
  const decrypted = Promise.withResolvers();
  await withConnection(
    async (client, state) => {
      state.controller.enqueue(
        frame({
          data: {
            type: 1,
            encryptedData: {
              ciphertext: Buffer.from("one"),
              plaintextLength: 3,
            },
          },
        }),
      );
      await tick();
      const reads = state.readCalls;
      state.controller.enqueue(
        frame({ data: { type: 1, data: Buffer.from("two") } }),
      );
      await tick();
      try {
        assert.equal(state.readCalls, reads);
      } finally {
        client.disconnect();
        decrypted.resolve(Buffer.from("one"));
      }
      await tick();
      assert.deepEqual(state.output, []);
      assert.equal(state.cancelled, 1);
      assert.equal(state.readable.locked, false);
    },
    {},
    undefined,
    { payloadCrypto: { decryptStdout: () => decrypted.promise } },
  );
});

test("WebTransport rejects a truncated frame at EOF", async () => {
  await withConnection(async (_client, state) => {
    state.controller.enqueue(new Uint8Array([0, 0, 0, 8, 1, 2]));
    state.controller.close();
    await tick();
    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0], /Incomplete WebTTY frame/);
    assert.equal(state.closed, 1);
  });
});

test("WebTTY rejects invalid message limits before opening a connection", () => {
  for (const maxMessageSize of [0, -1, 1.5, NaN, Infinity, 0x100000000]) {
    assert.throws(
      () =>
        new WebTTY({
          url: "https://shell.example.test",
          transport: "webtransport",
          maxMessageSize,
        }),
      /maxMessageSize/,
    );
  }
});

for (const phase of ["ready", "stream"]) {
  for (const failure of ["reject", "cancel"]) {
    test(`WebTransport releases the connection on ${phase} ${failure}`, async () => {
      const previous = global.WebTransport;
      const instances = [];
      const entered = Promise.withResolvers();
      const closed = Promise.withResolvers();
      const errors = [];
      global.WebTransport = class {
        constructor() {
          this.closeCalls = 0;
          this.closed = new Promise(() => {});
          this.ready = phase === "ready" ? this.pending() : Promise.resolve();
          instances.push(this);
        }
        pending() {
          entered.resolve();
          return failure === "reject"
            ? Promise.reject(new Error("fixture failure"))
            : new Promise(() => {});
        }
        createBidirectionalStream() {
          return this.pending();
        }
        close() {
          this.closeCalls += 1;
          closed.resolve();
        }
      };
      try {
        const client = new WebTTY(
          { url: "https://shell.example.test", transport: "webtransport" },
          undefined,
          { onError: (error) => errors.push(error) },
        );
        client.connect();
        await entered.promise;
        if (failure === "cancel") client.disconnect();
        await Promise.race([
          closed.promise,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("WebTransport was not closed")),
              1000,
            );
            timer.unref();
          }),
        ]);
        await new Promise((resolve) => setImmediate(resolve));
        client.disconnect();
        assert.equal(instances.length, 1);
        assert.equal(instances[0].closeCalls, 1);
        assert.equal(errors.length, 1);
      } finally {
        global.WebTransport = previous;
      }
    });
  }
}
