// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createAPPTURNCredentials,
  createPATTURNCredentials,
  createTURNCredentials,
  RstreamTunnelsClient,
} = require("../dist/index.js");

function createPATToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
    .toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("PAT TURN credentials are derived locally", async () => {
  const token = createPATToken({
    token_endpoint: "tok_ep",
    type: "pat",
  });
  const credentials = createPATTURNCredentials({
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    token,
    ttlSeconds: 3600,
  });
  const username = "v1:1700003600:pat:project-endpoint:tok_ep";
  const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest();
  const key = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      tokenHash,
      Buffer.from("cluster.example.rstream.test", "utf8"),
      Buffer.from("turn-pat-v1", "utf8"),
      32,
    ),
  );
  const credential = crypto
    .createHmac("sha256", key)
    .update(username, "utf8")
    .digest("base64");
  assert.deepEqual(credentials, {
    credential,
    ttl: 3600,
    urls: [
      "turn:cluster.example.rstream.test:3478?transport=udp",
      "turn:cluster.example.rstream.test:3478?transport=tcp",
      "turns:cluster.example.rstream.test:5349?transport=udp",
      "turns:cluster.example.rstream.test:5349?transport=tcp",
    ],
    username,
  });
});

test("APP TURN credentials are derived locally", async () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const serverKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const clientId = "client-id";
  const clientSecret = clientKeys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("hex");
  const serverPublicKeyHex = serverKeys.publicKey
    .export({ type: "spki", format: "der" })
    .toString("hex");
  const credentials = await createAPPTURNCredentials({
    clientId,
    clientSecret,
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    serverPublicKeyHex,
    ttlSeconds: 3600,
  });
  const username = "v1:1700003600:app:project-endpoint:client-id";
  const sharedSecret = crypto.diffieHellman({
    privateKey: clientKeys.privateKey,
    publicKey: serverKeys.publicKey,
  });
  const key = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      sharedSecret,
      Buffer.from("cluster.example.rstream.test", "utf8"),
      Buffer.from("turn-app-v1", "utf8"),
      32,
    ),
  );
  const credential = crypto
    .createHmac("sha256", key)
    .update(username, "utf8")
    .digest("base64");
  assert.deepEqual(credentials, {
    credential,
    ttl: 3600,
    urls: [
      "turn:cluster.example.rstream.test:3478?transport=udp",
      "turn:cluster.example.rstream.test:3478?transport=tcp",
      "turns:cluster.example.rstream.test:5349?transport=udp",
      "turns:cluster.example.rstream.test:5349?transport=tcp",
    ],
    username,
  });
});

test("APP TURN credentials load the keyring when needed", async () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const serverKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const originalFetch = global.fetch;
  const serverPublicKeyHex = serverKeys.publicKey
    .export({ type: "spki", format: "der" })
    .toString("hex");
  const calls = [];
  global.fetch = async (input) => {
    calls.push(input.toString());
    return new Response(serverPublicKeyHex, {
      headers: { "Content-Type": "text/plain" },
      status: 200,
    });
  };
  try {
    const credentials = await createAPPTURNCredentials({
      clientId: "client-id",
      clientSecret: clientKeys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("hex"),
      clusterDomain: "cluster.example.rstream.test",
      keyringBaseUrl: "https://keyrings.rstream.io",
      now: 1_700_000_000,
      projectEndpoint: "project-endpoint",
      ttlSeconds: 3600,
    });
    assert.equal(
      credentials.username,
      "v1:1700003600:app:project-endpoint:client-id",
    );
    assert.deepEqual(calls, [
      "https://keyrings.rstream.io/keyrings/turn/cluster.example.rstream.test.spki.der.hex",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("auto TURN mode falls back to the managed API for auth tokens", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    return new Response(
      JSON.stringify({
        credential: "cred",
        ttl: 3600,
        urls: ["turn:cluster.example:3478?transport=udp"],
        username: "user",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  };
  try {
    const credentials = await createTURNCredentials({
      apiUrl: "https://rstream.io",
      credentials: { token: createPATToken({ type: "auth" }) },
      projectEndpoint: "project-endpoint",
    });
    assert.equal(credentials.username, "user");
    assert.deepEqual(calls, [
      {
        authorization:
          `Bearer ${createPATToken({ type: "auth" })}`,
        method: "POST",
        url: "https://rstream.io/api/projects/tunnels/resolve/project-endpoint/turn-server/credentials",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("auto TURN mode derives APP credentials from client credentials", async () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const serverKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const credentials = await createTURNCredentials({
    credentials: {
      clientId: "client-id",
      clientSecret: clientKeys.privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("hex"),
    },
    engine: "project-endpoint.cluster.example.rstream.test:443",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    serverPublicKeyHex: serverKeys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("hex"),
    ttlSeconds: 3600,
  });
  assert.equal(
    credentials.username,
    "v1:1700003600:app:project-endpoint:client-id",
  );
  assert.deepEqual(credentials.urls, [
    "turn:cluster.example.rstream.test:3478?transport=udp",
    "turn:cluster.example.rstream.test:3478?transport=tcp",
    "turns:cluster.example.rstream.test:5349?transport=udp",
    "turns:cluster.example.rstream.test:5349?transport=tcp",
  ]);
});

test("TURN resource derives PAT credentials from the client configuration", async () => {
  const token = createPATToken({
    token_endpoint: "tok_ep",
    type: "pat",
  });
  const client = new RstreamTunnelsClient({
    credentials: { token },
    engine: "project-endpoint.cluster.example.rstream.test:443",
    projectEndpoint: "project-endpoint",
  });
  const credentials = await client.turn.createCredentials({
    now: 1_700_000_000,
    ttlSeconds: 3600,
  });
  assert.equal(
    credentials.username,
    "v1:1700003600:pat:project-endpoint:tok_ep",
  );
  assert.deepEqual(credentials.urls, [
    "turn:cluster.example.rstream.test:3478?transport=udp",
    "turn:cluster.example.rstream.test:3478?transport=tcp",
    "turns:cluster.example.rstream.test:5349?transport=udp",
    "turns:cluster.example.rstream.test:5349?transport=tcp",
  ]);
});
