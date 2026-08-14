// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");

const { Client } = require("../../dist/index.js");

const timeoutMs = Number(process.env.RSTREAM_RUNTIME_E2E_TIMEOUT_MS ?? "30000");
const namePrefix = process.env.RSTREAM_RUNTIME_E2E_NAME_PREFIX ?? "js-runtime-e2e";
const insecureTls = process.env.RSTREAM_RUNTIME_E2E_TLS_INSECURE === "1";
const mtlsCertFile = process.env.RSTREAM_MTLS_CERT_FILE;
const mtlsKeyFile = process.env.RSTREAM_MTLS_KEY_FILE;
const agentAuthMode =
  mtlsCertFile || mtlsKeyFile
    ? "mTLS-agent-auth"
    : "token-auth";
const mtlsCredentials =
  mtlsCertFile && mtlsKeyFile
    ? {
        cert: readFileSync(mtlsCertFile),
        key: readFileSync(mtlsKeyFile),
      }
    : undefined;
const websocketKey = Buffer.from("the sample nonce").toString("base64");

function client() {
  return Client.fromEnv({
    heartbeatIntervalMs: 1000,
    tls: insecureTls ? { rejectUnauthorized: false } : undefined,
  });
}

function withTimeout(promise, label) {
  const timeout = new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs).unref?.();
  });
  return Promise.race([promise, timeout]);
}

function readChunk(stream, label) {
  return withTimeout(new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };
    const onData = (chunk) => {
      cleanup();
      resolve(chunk);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`${label} ended before data was received.`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    stream.once("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
  }), label);
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function isClientCertificateRequiredError(error) {
  return (
    error?.code === "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED" ||
    /certificate required/i.test(String(error?.message ?? error))
  );
}

async function assertMissingCertificateRejected(promise, label) {
  try {
    const response = await promise;
    if (typeof response === "string") {
      assert.match(response, /401 Unauthorized/, label);
      return;
    }
    assert.equal(response.statusCode, 401, label);
  } catch (error) {
    if (isClientCertificateRequiredError(error)) return;
    throw error;
  }
}

function requestHttps(url, options = {}) {
  return withTimeout(new Promise((resolve, reject) => {
    const req = https.request(url, {
      cert: options.cert,
      headers: options.headers,
      key: options.key,
      method: "GET",
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          statusCode: res.statusCode,
        });
      });
    });
    req.on("error", reject);
    req.end();
  }), `HTTPS request to ${url}`);
}

function requestWebSocketUpgrade(url, options = {}) {
  return withTimeout(new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const socket = tls.connect({
      cert: options.cert,
      host: parsed.hostname,
      key: options.key,
      port: parsed.port ? Number(parsed.port) : 443,
      rejectUnauthorized: false,
      servername: parsed.hostname,
    });
    let response = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("secureConnect", onSecureConnect);
    };
    const onData = (chunk) => {
      response += chunk.toString("utf8");
      if (!response.includes("\r\n\r\n")) return;
      cleanup();
      socket.destroy();
      resolve(response);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onSecureConnect = () => {
      socket.write([
        `GET ${parsed.pathname} HTTP/1.1`,
        `Host: ${parsed.host}`,
        ...(options.cookie ? [`Cookie: ${options.cookie}`] : []),
        "Connection: Upgrade",
        "Upgrade: websocket",
        `Sec-WebSocket-Key: ${websocketKey}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("secureConnect", onSecureConnect);
  }), `WebSocket upgrade to ${url}`);
}

async function closeResource(resource) {
  if (typeof resource.close === "function") {
    await resource.close();
    return;
  }
  if (typeof resource.destroy === "function") resource.destroy();
}

async function runPrivateBytestreamDial() {
  const tunnelName = `${namePrefix}-${randomUUID()}`;
  const ctrl = await withTimeout(client().connect(), "control channel connect");
  const resources = [ctrl];
  try {
    const tunnel = await withTimeout(ctrl.createTunnel({
      name: tunnelName,
      publish: false,
      type: "bytestream",
    }), "private bytestream tunnel creation");
    resources.push(tunnel);

    const acceptedPromise = withTimeout(tunnel.accept(), "private bytestream accept");
    const dialed = await withTimeout(client().dial(tunnelName), "private bytestream dial");
    resources.push(dialed);
    const accepted = await acceptedPromise;
    resources.push(accepted);

    const request = Buffer.from(`ping:${tunnelName}`);
    const response = Buffer.from(`pong:${tunnelName}`);
    dialed.write(request);
    assert.deepEqual(await readChunk(accepted, "server read"), request);
    accepted.write(response);
    assert.deepEqual(await readChunk(dialed, "client read"), response);

    const acceptedByIdPromise = withTimeout(tunnel.accept(), "private bytestream accept by ID");
    const dialedById = await withTimeout(client().dial(tunnel.id), "private bytestream dial by ID");
    resources.push(dialedById);
    const acceptedById = await acceptedByIdPromise;
    resources.push(acceptedById);
    const requestById = Buffer.from(`id-ping:${tunnel.id}`);
    const responseById = Buffer.from(`id-pong:${tunnel.id}`);
    dialedById.write(requestById);
    assert.deepEqual(await readChunk(acceptedById, "server read by ID"), requestById);
    acceptedById.write(responseById);
    assert.deepEqual(await readChunk(dialedById, "client read by ID"), responseById);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const acceptedAfterHeartbeatsPromise = withTimeout(tunnel.accept(), "private bytestream accept after heartbeats");
    const dialedAfterHeartbeats = await withTimeout(client().dial(tunnelName), "private bytestream dial after heartbeats");
    resources.push(dialedAfterHeartbeats);
    const acceptedAfterHeartbeats = await acceptedAfterHeartbeatsPromise;
    resources.push(acceptedAfterHeartbeats);
    const requestAfterHeartbeats = Buffer.from(`heartbeat:${tunnelName}`);
    dialedAfterHeartbeats.write(requestAfterHeartbeats);
    assert.deepEqual(await readChunk(acceptedAfterHeartbeats, "server read after heartbeats"), requestAfterHeartbeats);
    console.log(`PASS private bytestream ${agentAuthMode} create + direct dial by name and ID + byte relay ${tunnelName}`);
  } finally {
    await Promise.allSettled(resources.reverse().map(closeResource));
  }
}

async function runPublishedHttpUrl() {
  const tunnelName = `${namePrefix}-http-${randomUUID()}`;
  const ctrl = await withTimeout(client().connect(), "control channel connect");
  const resources = [ctrl];
  const controller = new AbortController();
  let serving;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`published:${tunnelName}:${req.method}:${req.url}`);
  });
  server.on("upgrade", (_req, socket) => {
    socket.end([
      "HTTP/1.1 101 Switching Protocols",
      "Connection: Upgrade",
      "Upgrade: websocket",
      `X-Rstream-E2E: ${tunnelName}`,
      "",
      "",
    ].join("\r\n"));
  });
  try {
    const tunnel = await withTimeout(ctrl.createTunnel({
      httpVersion: "http/1.1",
      name: tunnelName,
      protocol: "http",
      publish: true,
      type: "bytestream",
    }), "published HTTP bytestream tunnel creation");
    resources.push(tunnel);
    const forwarding = await withTimeout(tunnel.forwardingAddress(), "published forwarding address");
    serving = tunnel.serve(server, { signal: controller.signal });
    const response = await requestHttps(`${forwarding}/probe`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, `published:${tunnelName}:GET:/probe`);
    const upgrade = await requestWebSocketUpgrade(`${forwarding}/socket`);
    assert.match(upgrade, /101 Switching Protocols/);
    assert.match(upgrade, new RegExp(`X-Rstream-E2E: ${tunnelName}`, "i"));
    console.log(`PASS published HTTP ${agentAuthMode} create + HTTPS URL fetch + WebSocket upgrade + upstream relay ${forwarding}`);
  } finally {
    controller.abort();
    await Promise.allSettled([
      serving,
      closeServer(server),
      ...resources.reverse().map(closeResource),
    ]);
  }
}

async function runPublishedHttpMtlsUrl() {
  if (mtlsCredentials === undefined) return;

  const tunnelName = `${namePrefix}-http-mtls-${randomUUID()}`;
  const ctrl = await withTimeout(client().connect(), "mTLS control channel connect");
  const resources = [ctrl];
  const controller = new AbortController();
  let serving;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`published-mtls:${tunnelName}:${req.method}:${req.url}`);
  });
  server.on("upgrade", (_req, socket) => {
    socket.end([
      "HTTP/1.1 101 Switching Protocols",
      "Connection: Upgrade",
      "Upgrade: websocket",
      `X-Rstream-E2E-MTLS: ${tunnelName}`,
      "",
      "",
    ].join("\r\n"));
  });
  try {
    const tunnel = await withTimeout(ctrl.createTunnel({
      httpVersion: "http/1.1",
      mtlsAuth: true,
      name: tunnelName,
      protocol: "http",
      publish: true,
      type: "bytestream",
    }), "published HTTP mTLS bytestream tunnel creation");
    resources.push(tunnel);
    const forwarding = await withTimeout(tunnel.forwardingAddress(), "published mTLS forwarding address");
    serving = tunnel.serve(server, { signal: controller.signal });

    await assertMissingCertificateRejected(
      requestHttps(`${forwarding}/mtls-probe`),
      "published mTLS request without certificate must be rejected",
    );

    const authenticated = await requestHttps(`${forwarding}/mtls-probe`, mtlsCredentials);
    assert.equal(authenticated.statusCode, 200);
    assert.equal(authenticated.body, `published-mtls:${tunnelName}:GET:/mtls-probe`);

    const conflict = await requestHttps(`${forwarding}/mtls-conflict`, {
      ...mtlsCredentials,
      headers: { cookie: "rstream_auth=session" },
    });
    assert.equal(conflict.statusCode, 401);

    await assertMissingCertificateRejected(
      requestWebSocketUpgrade(`${forwarding}/mtls-socket`),
      "published mTLS WebSocket upgrade without certificate must be rejected",
    );

    const authenticatedUpgrade = await requestWebSocketUpgrade(`${forwarding}/mtls-socket`, mtlsCredentials);
    assert.match(authenticatedUpgrade, /101 Switching Protocols/);
    assert.match(authenticatedUpgrade, new RegExp(`X-Rstream-E2E-MTLS: ${tunnelName}`, "i"));

    const conflictingUpgrade = await requestWebSocketUpgrade(`${forwarding}/mtls-conflict-socket`, {
      ...mtlsCredentials,
      cookie: "rstream_auth=session",
    });
    assert.match(conflictingUpgrade, /401 Unauthorized/);

    console.log(`PASS published HTTP downstream mTLS ${agentAuthMode} rejects missing cert + accepts registered cert + WebSocket upgrade + rejects mixed auth proofs ${forwarding}`);
  } finally {
    controller.abort();
    await Promise.allSettled([
      serving,
      closeServer(server),
      ...resources.reverse().map(closeResource),
    ]);
  }
}

async function main() {
  await runPrivateBytestreamDial();
  await runPublishedHttpUrl();
  await runPublishedHttpMtlsUrl();
}

function formatError(error) {
  if (error && error.code === "ECONNREFUSED") {
    return `Runtime E2E could not connect to the configured engine at ${error.address}:${error.port}. Start an engine or set RSTREAM_ENGINE, RSTREAM_AUTHENTICATION_TOKEN, and optional RSTREAM_RUNTIME_E2E_TLS_INSECURE=1 before running this check.`;
  }
  return error;
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
