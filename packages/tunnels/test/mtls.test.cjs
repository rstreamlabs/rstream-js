// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const https = require("node:https");
const test = require("node:test");
const { cert, key } = require("./fixtures/tls.cjs");
const { RstreamTunnelsClient, createTURNCredentials } = require("../dist/index.js");

async function server(t, options, handler) {
  const instance = https.createServer({ cert, key, ...options }, handler);
  await new Promise((resolve, reject) => { instance.once("error", reject); instance.listen(0, "localhost", resolve); });
  t.after(async () => { instance.closeAllConnections(); await new Promise((resolve) => instance.close(resolve)); });
  return `localhost:${instance.address().port}`;
}
const credentials = { username: "v2:2000000000:issued:localhost:credential:certificate-1:k1", credential: "password", urls: ["turn:turn.test:3478?transport=udp"], ttl: 600 };
const tls = { ca: cert, cert, key };

test("certificate-only Engine requests and TURN renewals share one anonymous discovery", async (t) => {
  let discoveries = 0;
  let calls = 0;
  let controlPlaneCalls = 0;
  const target = await server(t, { requestCert: true, rejectUnauthorized: false }, (req, res) => {
    assert.ok(req.socket.getPeerCertificate().raw);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.url, "/api/turn-server/credentials");
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(credentials));
  });
  const source = await server(t, { requestCert: true, rejectUnauthorized: false }, (req, res) => {
    assert.equal(req.socket.getPeerCertificate().raw, undefined);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.url, "/.well-known/rstream/engine");
    discoveries++;
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(JSON.stringify({ version: 1, projectEndpoint: "localhost", mtlsApiUrl: `https://${target}/api`, capabilities: ["engine-api-mtls", "turn-credentials-v2"] }));
  });
  const oldToken = process.env.RSTREAM_TOKEN;
  process.env.RSTREAM_TOKEN = "ambient-admin-token";
  t.after(() => { if (oldToken === undefined) delete process.env.RSTREAM_TOKEN; else process.env.RSTREAM_TOKEN = oldToken; });
  const client = new RstreamTunnelsClient({ engine: source, tls, projectEndpoint: "localhost", controlPlaneCredentials: { token: "control-admin-token" } });
  t.after(() => client.close());
  const results = await Promise.all(Array.from({ length: 24 }, () => client.turn.createCredentials({ fetch: async () => { controlPlaneCalls++; throw new Error("Control plane must not be used"); } })));
  assert.equal(results.length, 24);
  assert.equal(calls, 24);
  assert.equal(controlPlaneCalls, 0);
  assert.equal(discoveries, 1);
  assert.equal(await client.getEngineAPIURL(), `https://${target}/api`);
  assert.equal(discoveries, 1);
  await client.close();
  await assert.rejects(client.turn.createCredentials(), /closed/);
});

test("discovery rejects redirects, invalid scope and untrusted TLS before using a certificate", async (t) => {
  let authenticated = 0;
  const target = await server(t, { requestCert: true, rejectUnauthorized: false }, (_req, res) => { authenticated++; res.end("{}"); });
  for (const scenario of ["redirect", "wrong-project", "wrong-target", "untrusted", "oversized"]) {
    const source = await server(t, {}, (_req, res) => {
      if (scenario === "redirect") { res.writeHead(302, { Location: `https://${target}/api` }); res.end(); return; }
      if (scenario === "oversized") { res.end("x".repeat(16385)); return; }
      res.end(JSON.stringify({ version: 1, projectEndpoint: scenario === "wrong-project" ? "other" : "localhost", mtlsApiUrl: scenario === "wrong-target" ? "https://other.example/api" : `https://${target}/api`, capabilities: ["engine-api-mtls"] }));
    });
    const client = new RstreamTunnelsClient({ engine: source, tls: scenario === "untrusted" ? { cert, key, rejectUnauthorized: false } : tls });
    t.after(() => client.close());
    await assert.rejects(client.turn.createCredentials());
  }
  assert.equal(authenticated, 0);
});

test("certificate identity conflicts and invalid TURN TTL fail before network access", async () => {
  assert.throws(() => new RstreamTunnelsClient({ tls, credentials: { token: "token" } }), /token or mTLS/);
  const client = new RstreamTunnelsClient({ engine: "localhost:1", tls, mtlsApiUrl: "https://localhost:1/api" });
  try {
    for (const mode of ["api", "pat", "app"])
      await assert.rejects(client.turn.createCredentials({ mode, clusterDomain: "turn.test" }), /Certificate authentication/);
    for (const ttlSeconds of [0, 1.5, 3601])
      await assert.rejects(client.turn.createCredentials({ ttlSeconds }), /TURN TTL/);
    await assert.rejects(client.turn.createCredentials({ credentials: { token: "other" } }), /token or mTLS/);
  } finally { await client.close(); }
});

test("automatic TURN fallback honors status, response validation and cancellation", async (t) => {
  let engineCalls = 0;
  const client = new RstreamTunnelsClient({ engine: "project.engine.test", credentials: { token: "token" }, fetch: async () => { engineCalls++; return Response.json(credentials); } });
  t.after(() => client.close());
  for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503, 504]) {
    const previous = engineCalls;
    const options = { client, projectEndpoint: "project", fetch: async () => Response.json({ error: "denied" }, { status }) };
    if ([502, 503, 504].includes(status)) {
      assert.deepEqual(await createTURNCredentials(options), credentials);
      assert.equal(engineCalls, previous + 1);
    } else {
      await assert.rejects(createTURNCredentials(options), (error) => error.status === status);
      assert.equal(engineCalls, previous);
    }
  }
  const previous = engineCalls;
  await assert.rejects(createTURNCredentials({ client, projectEndpoint: "project", fetch: async () => Response.json({ bad: true }) }));
  await assert.rejects(createTURNCredentials({ client, projectEndpoint: "project", fetch: async () => { const error = new Error("untrusted"); error.code = "CERT_HAS_EXPIRED"; throw error; } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createTURNCredentials({ client, projectEndpoint: "project", signal: controller.signal, fetch: async (_input, init) => { init.signal.throwIfAborted(); return Response.json(credentials); } }));
  assert.equal(engineCalls, previous);
});

test("closing a client aborts outstanding discovery and its HTTP connection", async (t) => {
  let seen;
  const arrived = new Promise((resolve) => { seen = resolve; });
  const source = await server(t, {}, (_req, _res) => seen());
  const client = new RstreamTunnelsClient({ engine: source, tls });
  t.after(() => client.close());
  const pending = client.turn.createCredentials();
  const rejected = assert.rejects(pending);
  await arrived;
  await client.close();
  await rejected;
});

test("certificate watch reads split SSE frames and closes the owned stream", async (t) => {
  const { Watch } = require("../dist/index.js");
  let closed;
  const ended = new Promise((resolve) => { closed = resolve; });
  const event = { type: "state.initial", object: { snapshot_at: new Date().toISOString(), clients: [], tunnels: [] } };
  const target = await server(t, { requestCert: true, rejectUnauthorized: false }, (req, res) => {
    assert.equal(req.url, "/api/sse");
    assert.equal(req.headers.authorization, undefined);
    assert.ok(req.socket.getPeerCertificate().raw);
    req.on("close", closed);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": heartbeat\n\ndata: " + JSON.stringify(event).slice(0, 30));
    setImmediate(() => res.write(JSON.stringify(event).slice(30) + "\n\n"));
  });
  const client = new RstreamTunnelsClient({ engine: target, tls, mtlsApiUrl: `https://${target}/api` });
  t.after(() => client.close());
  let receive;
  const received = new Promise((resolve) => { receive = resolve; });
  let closes = 0;
  const watch = new Watch({ client }, { onEvent: receive, onClose: () => closes++ });
  await watch.connect();
  assert.deepEqual(await received, event);
  watch.disconnect();
  await ended;
  assert.equal(closes, 1);
});

test("automatic PAT derivation requires known relay permission and resolves aliases consistently", async () => {
  const claims = { type: "pat", exp: 2000000000, token_endpoint: "token-1", tokendpoint: "token-1", permissions: ["turn.relay.allocate"] };
  const token = (value) => `e30.${Buffer.from(JSON.stringify(value)).toString("base64url")}.sig`;
  let calls = 0;
  const options = { clusterDomain: "turn.test", now: 1999999400, projectEndpoint: "project-1", fetch: async () => { calls++; return Response.json(credentials); } };
  const local = await createTURNCredentials({ ...options, credentials: { token: token(claims) } });
  assert.equal(local.username, "v1:2000000000:pat:project-1:token-1");
  assert.equal(calls, 0);
  for (const permissions of [undefined, [], ["turn.credentials.create"]])
    assert.deepEqual(await createTURNCredentials({ ...options, credentials: { token: token({ ...claims, permissions }) } }), credentials);
  assert.equal(calls, 3);
  await assert.rejects(createTURNCredentials({ ...options, credentials: { token: token({ ...claims, tokendpoint: "other" }) } }), /Conflicting/);
  assert.equal(calls, 3);
});

test("JavaScript APP and PAT derivation match the shared Go fixture", async () => {
  const fixture = require("./fixtures/local-turn-v1.json");
  const { createAPPTURNCredentials, createPATTURNCredentials } = require("../dist/index.js");
  const options = { now: fixture.now, ttlSeconds: fixture.ttl, turnDomain: fixture.domain, turnRealm: fixture.realm, projectEndpoint: fixture.projectEndpoint };
  const app = await createAPPTURNCredentials({ ...options, ...fixture.app });
  assert.equal(app.username, fixture.app.username);
  assert.equal(app.credential, fixture.app.credential);
  const pat = createPATTURNCredentials({ ...options, token: fixture.pat.token });
  assert.equal(pat.username, fixture.pat.username);
  assert.equal(pat.credential, fixture.pat.credential);
  assert.equal(pat.urls[0], "turn:regional.test:3478?transport=udp");
  assert.deepEqual(app.urls, pat.urls);
});

test("APP TURN fallback signs only issuance rights without resolving project metadata", async (t) => {
  const fixture = require("./fixtures/local-turn-v1.json");
  const app = { clientId: fixture.app.clientId, clientSecret: fixture.app.clientSecret };
  const proofs = [];
  let cpCalls = 0;
  const client = new RstreamTunnelsClient({
    engine: "project-1.engine.test:443", projectEndpoint: "project-1", credentials: app,
    fetch: async (input, init) => {
      assert.equal(String(input), "https://project-1.engine.test:443/api/turn-server/credentials");
      proofs.push(new Headers(init.headers).get("Authorization"));
      return Response.json(credentials);
    },
  });
  t.after(() => client.close());
  await client.turn.createCredentials({
    credentials: { clientSecret: app.clientSecret, clientId: app.clientId },
    fetch: async (input, init) => {
      cpCalls++;
      assert.match(String(input), /\/turn-server\/credentials$/);
      proofs.push(new Headers(init.headers).get("Authorization"));
      return new Response("unavailable", { status: 503 });
    },
  });
  assert.equal(cpCalls, 1);
  assert.equal(proofs.length, 2);
  const crypto = require("node:crypto");
  const publicKey = crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.from(app.clientSecret, "hex"), format: "der", type: "pkcs8" }));
  for (const proof of proofs) {
    const parts = proof.slice(7).split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
    assert.deepEqual(payload.permissions, ["turn.credentials.create"]);
    assert.equal(payload.clientId, app.clientId);
    assert.equal(payload.exp - payload.iat, 60);
    assert.equal(crypto.verify("sha512", Buffer.from(parts[0] + "." + parts[1]), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(parts[2], "base64url")), true);
  }
});
