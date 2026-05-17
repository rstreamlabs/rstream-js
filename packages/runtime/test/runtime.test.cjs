// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const tls = require("node:tls");
const protobuf = require("protobufjs");

const { Client } = require("../dist/index.js");

const cert = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUIJFC1ft4PkZbVykXpVMOtsDAIg8wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDUxMzE5MDg1M1oXDTM2MDUx
MDE5MDg1M1owFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA2XI9Or5Jm9uYh0r2ti0l03wYKa1WMXdMTTpSjc6C2ctW
+oLuqCqrcsQ1S5F6PNhml/RC1KkctYveDqCxtvp2LWkmj1OCkWHehagS/2T6N4lv
+pduNYlMukRuR0FH+2yz0HNV7WMedwbEC491S+AGTRpGH4y0Fi9EekzGsEJ/DotS
J4us5r5+QsbKPCdaTKRohpNQstgo3Unvdo0XjGqMVkCYlpfypfeMlUnLUeRSEpuf
MJkjZvTFveFy1VwPVyqVtPsUt2ajHXz2/PSNxeZz/Rwy7Z/CvK0WdZRFPW55Ov+L
esM09FffW1LHWjv3mEoNom8D9Vd+Qvw1/SDqbBFflQIDAQABo1MwUTAdBgNVHQ4E
FgQUqDeXVTlAyec2kLHpf94igLrhw/owHwYDVR0jBBgwFoAUqDeXVTlAyec2kLHp
f94igLrhw/owDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAlpWZ
HsOyXrJjIewuP3bFWNX65OWC5wN6/lu/T0G7Mzmfs/mqPrvGbx9YfW+CH4ugImUT
Odkwqqb1TbNf3djF+vSkAVIf31xYejossKK5Qd8MZzs2nhiJDEbAXJPjtABdO2tm
xJqoVVUOH1zzeIqf77udGDU3CdanCcA73D4Y9YyPiXwfG9wospzbrPHdT0wJ0b5s
r0K4FdU1ngIaiKrWzOUrxR+OD9TypD+y8FAQT6qxETx9xMTfTHCbIfaLi5/V8CZw
pbrC4kW91Y3BNiUSF3jnR5c18jazboGVyZuEqcaZTCGy96CNhH5oxA9AY+eQnla9
WrmtxN/SvjzUKFneFg==
-----END CERTIFICATE-----`;

const privateKeyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const privateKeyFooter = ["-----END", "PRIVATE KEY-----"].join(" ");
const privateKeyBody = `MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDZcj06vkmb25iH
Sva2LSXTfBgprVYxd0xNOlKNzoLZy1b6gu6oKqtyxDVLkXo82GaX9ELUqRy1i94O
oLG2+nYtaSaPU4KRYd6FqBL/ZPo3iW/6l241iUy6RG5HQUf7bLPQc1XtYx53BsQL
j3VL4AZNGkYfjLQWL0R6TMawQn8Oi1Ini6zmvn5Cxso8J1pMpGiGk1Cy2CjdSe92
jReMaoxWQJiWl/Kl94yVSctR5FISm58wmSNm9MW94XLVXA9XKpW0+xS3ZqMdfPb8
9I3F5nP9HDLtn8K8rRZ1lEU9bnk6/4t6wzT0V99bUsdaO/eYSg2ibwP1V35C/DX9
IOpsEV+VAgMBAAECggEAD0kfksSTqhgqxb/4TeAom5BKpotf1sRbIcaqzPsqaaMI
rz2LB1lQihXO5UwJusM/mwj5tbdZpE17w616MLG0owaURlkJgazOlri09S0lBchs
jcIdZjgLo8BxvCKTq9H9ZfbloHVqS9W27FUeWsIZz0u8iDU8555VAv/oq7VQ9zWk
z+DjM/HzVGi0m0CiGpk+oS7SAuGypChKBalBmBb7EAgXz1FRbD0URxl0ZRzRXmao
eDZkcWqbLlcm1n8TqHJmoXHcyd9NxVF5OadK0dfrGjhiy++FYs+xXSrW6Z7GURe9
QxEs5rnf4DENyHrQesonIELnIMeIECVLFLi82QIxlQKBgQD3suBAoDYrrdsgYkFO
aWMVk1utdGxKYSZAQ+obzAqqSlZz1iv+VJQrIhNixJfd7AVyzbAGsYp9IwqznK96
W6zTc3fxPJNOZBVwjAgPOe4B01nxtJ1E2JxYjeyqUeUiklr7MdrbM9QyEUKAQO5s
D1znkaRuG10kva6P1Q2Z4cMh2wKBgQDgu9AX0nF4EePiFoJzEFtRJezxqpJ1owpk
IPNgJJYqAYPL/MLSKyE5/LOhXbiPwXO6iRfdGCf1T9wSUIR0HOJU9oYujW9+68pn
wr8DgzSSt9FsffOU7tdUquhyuBkmp9yck3R+bp7Crd3vU/L4274WbZZw+OR2/U8/
d33clbHXTwKBgDrMTmlo3pMNyRdt23zGjYvAmCGbol0hpJfax0bj76Au10jWDUlp
QGbgxuNKMZavgTeYVfGw0WQVHmQ2jH0qJ+Nl5JHyRDF2lpRJ2Vvr73ClgBNdQXvn
Q23N+uEPYaoMPealFgO00Ok1qaiSQUaLew1JSFQO0NR45mgkNf9SVSTDAoGBAKyG
gpJHNGUBFvkSXsMG45PAkc5VLGqy599GjJBahg1pbEzFlqrSAYgKv7w5vt5dnQKv
DGrniIWC8Wf9+DFLm1WujARhAB9n1NMjZpDDwTCBfXzUlJLZaOXO7vRi8KwEYhCy
AtStB6Rc5ew9fmIeECgXqU7BRGM0xAntKeqV4RlxAoGBAKqI1QCTV73Dgb6DVqOA
dbwATvgwoQ/ejViqUJoNpTSYTHARISsCjbZD/vfea2hLPkK/f0DCc0m010bIS2zG
YoXi+4eRrL/hRGPZ1tRF8Et+9EiKou4Yp9Jn36RhtQrh+NnU45n+S9tmGfbF3NNW
RELCaXzw0H+tfCroDl3/V70/
`;
const key = `${privateKeyHeader}
${privateKeyBody}${privateKeyFooter}`;

const root = new protobuf.Root();
root.resolvePath = (_origin, target) =>
  target.startsWith("google/protobuf/")
    ? path.join(__dirname, "../../../node_modules/protobufjs", target)
    : path.join(__dirname, "../protobuf", target);
root.loadSync("rstream.proto");
const Message = root.lookupType("rstream.io_rstrm.protobuf.Message");

function deferred() {
  const result = {};
  result.promise = new Promise((resolve, reject) => {
    result.resolve = resolve;
    result.reject = reject;
  });
  return result;
}

async function writeFrame(socket, payload) {
  const body = Message.encode(Message.create(payload)).finish();
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  await new Promise((resolve, reject) => {
    socket.write(Buffer.concat([header, body]), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function frameReader(socket) {
  const values = [];
  const waiters = [];
  let buffer = Buffer.alloc(0);
  const fail = (error) => {
    while (waiters.length > 0) waiters.shift().reject(error);
  };
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < length + 4) return;
      const payload = buffer.subarray(4, length + 4);
      buffer = buffer.subarray(length + 4);
      const message = Message.decode(payload);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(message);
      else values.push(message);
    }
  });
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("socket closed")));
  return {
    read() {
      const value = values.shift();
      if (value) return Promise.resolve(value);
      return new Promise((resolve, reject) => waiters.push({ reject, resolve }));
    },
  };
}

class RuntimeProtocolHarness {
  constructor(options = {}) {
    this.options = options;
    this.connections = [];
    this.proxyConnections = new Map();
    this.proxyResponses = new Map();
    this.streamConnections = [];
    this.openControlMessages = [];
    this.controlAuthorized = undefined;
    this.controlAuthorizationError = undefined;
    this.controlPeerCertificate = undefined;
    this.server = tls.createServer({
      ALPNProtocols: ["rstrm/1"],
      ca: options.requireClientCertificate === true ? cert : undefined,
      cert,
      key,
      rejectUnauthorized: options.requireClientCertificate === true,
      requestCert: options.requireClientCertificate === true,
    }, (socket) => void this.handleConnection(socket));
  }

  async start() {
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    assert.equal(typeof address, "object");
    this.engine = `127.0.0.1:${address.port}`;
    return this;
  }

  async close() {
    for (const connection of this.connections) connection.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }

  async handleConnection(socket) {
    this.connections.push(socket);
    const reader = frameReader(socket);
    const first = await reader.read();
    if (first.openControlChannelReq) {
      this.control = socket;
      this.controlReader = reader;
      this.controlAuthorized = socket.authorized;
      this.controlAuthorizationError = socket.authorizationError;
      this.controlPeerCertificate = socket.getPeerCertificate();
      this.openControlMessages.push(first.openControlChannelReq);
      await writeFrame(socket, {
        openControlChannelRsp: {
          ok: {
            clientId: "client-1",
            serverDetails: { agent: { value: "runtime-test-engine" } },
          },
        },
      });
      void this.controlLoop();
      return;
    }
    if (first.proxyReq) {
      const streamId = first.proxyReq.streamId;
      const pending = this.proxyConnections.get(streamId);
      if (first.proxyReq.zeroRtt?.value === false) await writeFrame(socket, { proxyRsp: {} });
      pending?.resolve(socket);
      return;
    }
    if (first.streamReq) {
      this.streamConnections.push({ message: first.streamReq, socket });
      if (first.streamReq.zeroRtt?.value === false) {
        await writeFrame(socket, { streamRsp: { streamId: "stream-1" } });
      }
      return;
    }
    socket.destroy();
  }

  async controlLoop() {
    for (;;) {
      const message = await this.controlReader.read();
      if (message.openTunnelReq) {
        await this.handleOpenTunnelReq(message.openTunnelReq);
      } else if (message.closeTunnelReq) {
        await writeFrame(this.control, { closeTunnelRsp: { tunnelId: message.closeTunnelReq.tunnelId } });
      } else if (message.closeControlChannelReq) {
        await writeFrame(this.control, { closeControlChannelRsp: {} });
        this.control.end();
        return;
      } else if (message.proxyConnRsp) {
        const pending = this.proxyResponses.get(message.proxyConnRsp.streamId);
        pending?.resolve(message.proxyConnRsp);
      }
    }
  }

  async handleOpenTunnelReq(request) {
    if (this.options.openTunnelError) {
      await writeFrame(this.control, {
        openTunnelRsp: {
          error: {
            code: 2000,
            message: { value: this.options.openTunnelError },
          },
          requestId: request.requestId,
        },
      });
      return;
    }
    const props = request.tunnelProperties ?? {};
    await writeFrame(this.control, {
      openTunnelRsp: {
        requestId: request.requestId,
        tunnelProperties: {
          ...props,
          hostname: props.hostname ?? { value: "app.t.example.test" },
          id: { value: "tun-1" },
          port: { value: 443 },
          type: { value: "bytestream" },
        },
      },
    });
  }

  async openIncoming(tunnelId = "tun-1") {
    const streamId = `stream-${Math.random().toString(16).slice(2)}`;
    const proxy = deferred();
    const response = deferred();
    this.proxyConnections.set(streamId, proxy);
    this.proxyResponses.set(streamId, response);
    await writeFrame(this.control, {
      proxyConnReq: {
        secret: { value: "proxy-secret" },
        streamId,
        tunnelId,
      },
    });
    const socket = await proxy.promise;
    const proxyRsp = await response.promise;
    assert.equal(proxyRsp.streamId, streamId);
    this.proxyConnections.delete(streamId);
    this.proxyResponses.delete(streamId);
    return socket;
  }
}

test("creates and closes a published bytestream HTTP tunnel", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const client = new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    token: "token-1",
  });
  const ctrl = await client.connect();
  assert.equal(ctrl.serverDetails().agent, "runtime-test-engine");
  const tunnel = await ctrl.createTunnel({
    auth: { rstream: true, token: true },
    httpVersion: "http/1.1",
    name: "web",
    protocol: "http",
    publish: true,
  });
  assert.equal(tunnel.id, "tun-1");
  assert.equal(await tunnel.forwardingAddress(), "https://app.t.example.test");
  assert.equal(engine.openControlMessages[0].clientDetails.token.value, "token-1");
  await tunnel.close();
  assert.equal(tunnel.closed, true);
  await ctrl.close();
});

test("rejects unsupported tunnel surfaces before opening protocol state", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const ctrl = await new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
  }).connect();
  await assert.rejects(
    () => ctrl.createTunnel({ name: "datagram", type: "datagram" }),
    (error) => {
      assert.match(error.message, /Only bytestream tunnels are supported/);
      assert.doesNotMatch(error.message, /yet/);
      return true;
    },
  );
  await assert.rejects(
    () => ctrl.createTunnel({ httpVersion: "h3", name: "http3" }),
    (error) => {
      assert.match(error.message, /does not support/);
      assert.doesNotMatch(error.message, /yet/);
      return true;
    },
  );
  await ctrl.close();
  assert.equal(engine.openControlMessages.length, 1);
});

test("connects the control channel with mTLS client authentication", async (t) => {
  const engine = await new RuntimeProtocolHarness({
    requireClientCertificate: true,
  }).start();
  t.after(() => engine.close());
  const client = new Client({
    engine: engine.engine,
    requireToken: true,
    tls: {
      cert,
      key,
      rejectUnauthorized: false,
    },
  });
  const ctrl = await client.connect();
  await ctrl.close();
  assert.equal(engine.controlAuthorized, true, engine.controlAuthorizationError);
  assert.equal(engine.controlPeerCertificate.subject.CN, "localhost");
  assert.equal(engine.openControlMessages.length, 1);
  assert.equal(engine.openControlMessages[0].clientDetails.token, null);
});

test("accepts inbound bytestream connections and relays bytes", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const ctrl = await new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
  }).connect();
  const tunnel = await ctrl.createBytestreamTunnel({ name: "echo" });
  const incoming = await engine.openIncoming();
  const accepted = await tunnel.accept();
  accepted.write("pong");
  assert.equal(await readBytes(incoming, 4), "pong");
  incoming.write("ping");
  assert.equal(await readBytes(accepted, 4), "ping");
  accepted.destroy();
  incoming.destroy();
  await ctrl.close();
});

test("queues multiple inbound streams in arrival order", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const ctrl = await new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
  }).connect();
  const tunnel = await ctrl.createBytestreamTunnel({ name: "queue" });
  const firstIncoming = await engine.openIncoming();
  const secondIncoming = await engine.openIncoming();
  const firstAccepted = await tunnel.accept();
  const secondAccepted = await tunnel.accept();
  firstIncoming.write("one");
  secondIncoming.write("two");
  assert.equal(await readBytes(firstAccepted, 3), "one");
  assert.equal(await readBytes(secondAccepted, 3), "two");
  firstIncoming.destroy();
  secondIncoming.destroy();
  firstAccepted.destroy();
  secondAccepted.destroy();
  await ctrl.close();
});

test("supports proxy connections when zero RTT is disabled", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const ctrl = await new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
    zeroRtt: false,
  }).connect();
  const tunnel = await ctrl.createBytestreamTunnel({ name: "proxy-no-0rtt" });
  const incoming = await engine.openIncoming();
  const accepted = await tunnel.accept();
  incoming.write("ack");
  assert.equal(await readBytes(accepted, 3), "ack");
  incoming.destroy();
  accepted.destroy();
  await ctrl.close();
});

test("rejects pending accept when a tunnel is closed", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const ctrl = await new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
  }).connect();
  const tunnel = await ctrl.createBytestreamTunnel({ name: "close-accept" });
  const pending = tunnel.accept();
  await tunnel.close();
  await assert.rejects(pending, /Tunnel closed/);
  await ctrl.close();
});

test("dials private bytestream tunnels", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const client = new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
    zeroRtt: false,
  });
  const conn = await client.dial("private-api");
  const stream = engine.streamConnections[0];
  assert.equal(stream.message.tunnelIdName, "private-api");
  conn.write("hello");
  assert.equal(await readBytes(stream.socket, 5), "hello");
  stream.socket.write("world");
  assert.equal(await readBytes(conn, 5), "world");
  conn.destroy();
  stream.socket.destroy();
});

test("dials private bytestream tunnels with per-call token override", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const client = new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    token: "client-token",
    zeroRtt: false,
  });
  const conn = await client.dial("private-api", { token: "dial-token" });
  const stream = engine.streamConnections[0];
  assert.equal(stream.message.clientDetails.token.value, "dial-token");
  conn.destroy();
  stream.socket.destroy();
});

test("serves HTTP and WebSocket upgrades over a bytestream tunnel", async (t) => {
  const engine = await new RuntimeProtocolHarness().start();
  t.after(() => engine.close());
  const ctrl = await new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
  }).connect();
  const tunnel = await ctrl.createBytestreamTunnel({
    httpVersion: "http/1.1",
    protocol: "http",
  });
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    socket.write("upgraded");
  });
  const controller = new AbortController();
  const serving = tunnel.serve(server, { signal: controller.signal });
  const httpClient = await engine.openIncoming();
  httpClient.write("GET / HTTP/1.1\r\nHost: app\r\nConnection: close\r\n\r\n");
  assert.match(await readUntil(httpClient, "ok"), /HTTP\/1\.1 200 OK/);
  const wsClient = await engine.openIncoming();
  wsClient.write("GET /ws HTTP/1.1\r\nHost: app\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n");
  assert.match(await readUntil(wsClient, "upgraded"), /101 Switching Protocols/);
  controller.abort();
  await serving;
  await ctrl.close();
});

test("surfaces engine errors from create tunnel", async (t) => {
  const engine = await new RuntimeProtocolHarness({ openTunnelError: "denied" }).start();
  t.after(() => engine.close());
  const ctrl = await new Client({
    engine: engine.engine,
    tls: { rejectUnauthorized: false },
    noToken: true,
  }).connect();
  await assert.rejects(
    () => ctrl.createTunnel({ name: "bad" }),
    /denied/,
  );
  await ctrl.close();
});

function readBytes(socket, size) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", reject);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < size) return;
      cleanup();
      const rest = buffer.subarray(size);
      if (rest.length > 0) socket.unshift(rest);
      resolve(buffer.subarray(0, size).toString("utf8"));
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function readUntil(socket, marker) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", reject);
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes(marker)) return;
      cleanup();
      resolve(buffer);
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}
