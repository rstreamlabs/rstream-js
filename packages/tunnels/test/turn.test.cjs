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
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("PAT TURN credentials are derived locally", async () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  const credentials = createPATTURNCredentials({
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    token,
    ttlSeconds: 3600,
  });
  const username = "v1:1700003600:pat:project-endpoint:1a2b3c4d";
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

test("PAT TURN credentials separate the relay domain from the authentication realm", () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  const credentials = createPATTURNCredentials({
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    token,
    tokenEndpoint: "1a2b3c4d",
    ttlSeconds: 3600,
    turnDomain: "regional.example.rstream.test",
    turnRealm: "global.example.rstream.test",
  });
  const username = "v1:1700003600:pat:project-endpoint:1a2b3c4d";
  const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest();
  const key = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      tokenHash,
      Buffer.from("global.example.rstream.test", "utf8"),
      Buffer.from("turn-pat-v1", "utf8"),
      32,
    ),
  );
  assert.equal(
    credentials.credential,
    crypto.createHmac("sha256", key).update(username, "utf8").digest("base64"),
  );
  assert.deepEqual(credentials.urls, [
    "turn:regional.example.rstream.test:3478?transport=udp",
    "turn:regional.example.rstream.test:3478?transport=tcp",
    "turns:regional.example.rstream.test:5349?transport=udp",
    "turns:regional.example.rstream.test:5349?transport=tcp",
  ]);
});

test("PAT TURN credentials accept existing endpoint claim spelling", () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    tokendpoint: "1a2b3c4d",
    type: "pat",
  });
  const credentials = createPATTURNCredentials({
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    token,
    tokenEndpoint: "1a2b3c4d",
    ttlSeconds: 3600,
  });
  assert.equal(
    credentials.username,
    "v1:1700003600:pat:project-endpoint:1a2b3c4d",
  );
});

test("PAT TURN credentials reject missing or conflicting endpoint identity", () => {
  const options = {
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    ttlSeconds: 3600,
  };
  assert.throws(
    () =>
      createPATTURNCredentials({
        ...options,
        token: createPATToken({ exp: 1_700_007_200, type: "pat" }),
      }),
    /carrying a token endpoint/,
  );
  assert.throws(
    () =>
      createPATTURNCredentials({
        ...options,
        token: createPATToken({
          exp: 1_700_007_200,
          token_endpoint: "1a2b3c4d",
          type: "pat",
        }),
        tokenEndpoint: "4d3c2b1a",
      }),
    /does not match/,
  );
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

test("APP TURN credentials separate the relay domain from the authentication realm", async () => {
  const clientKeys = crypto.generateKeyPairSync("ec", { namedCurve: "P-521" });
  const serverKeys = crypto.generateKeyPairSync("ec", { namedCurve: "P-521" });
  const credentials = await createAPPTURNCredentials({
    clientId: "client-id",
    clientSecret: clientKeys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    serverPublicKeyHex: serverKeys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("hex"),
    ttlSeconds: 3600,
    turnDomain: "regional.example.rstream.test",
    turnRealm: "global.example.rstream.test",
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
      Buffer.from("global.example.rstream.test", "utf8"),
      Buffer.from("turn-app-v1", "utf8"),
      32,
    ),
  );
  assert.equal(
    credentials.credential,
    crypto.createHmac("sha256", key).update(username, "utf8").digest("base64"),
  );
  assert.deepEqual(credentials.urls, [
    "turn:regional.example.rstream.test:3478?transport=udp",
    "turn:regional.example.rstream.test:3478?transport=tcp",
    "turns:regional.example.rstream.test:5349?transport=udp",
    "turns:regional.example.rstream.test:5349?transport=tcp",
  ]);
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
  global.fetch = async (input, init) => {
    calls.push(input.toString());
    assert.equal(init.redirect, "manual");
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
      keyringBaseUrl: "https://keyrings.rstream.io",
      now: 1_700_000_000,
      projectEndpoint: "project-endpoint",
      ttlSeconds: 3600,
      turnDomain: "regional.example.rstream.test",
      turnRealm: "global.example.rstream.test",
    });
    assert.equal(
      credentials.username,
      "v1:1700003600:app:project-endpoint:client-id",
    );
    assert.deepEqual(calls, [
      "https://keyrings.rstream.io/keyrings/turn/global.example.rstream.test.spki.der.hex",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("APP TURN keyring loading refuses redirects", async () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response("Redirecting...", {
      headers: { location: "https://identity.example.test/login" },
      status: 302,
    });
  try {
    await assert.rejects(
      () =>
        createAPPTURNCredentials({
          clientId: "client-id",
          clientSecret: clientKeys.privateKey
            .export({ type: "pkcs8", format: "der" })
            .toString("hex"),
          clusterDomain: "cluster.example.rstream.test",
          keyringBaseUrl: "https://keyrings.rstream.io",
          projectEndpoint: "project-endpoint",
        }),
      /redirected; redirects are refused/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("APP TURN keyring loading bounds and validates responses", async () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const clientSecret = clientKeys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("hex");
  const originalFetch = global.fetch;
  const cases = [
    { body: "<html>not a key</html>", expected: /hexadecimal DER/ },
    { body: "abc", expected: /hexadecimal DER/ },
    { body: "00".repeat(8_193), expected: /8 KiB limit/ },
  ];
  try {
    for (const current of cases) {
      global.fetch = async () => new Response(current.body, { status: 200 });
      await assert.rejects(
        () =>
          createAPPTURNCredentials({
            clientId: "client-id",
            clientSecret,
            clusterDomain: "cluster.example.rstream.test",
            keyringBaseUrl: "https://keyrings.rstream.io",
            projectEndpoint: "project-endpoint",
          }),
        current.expected,
      );
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("APP TURN credentials reject invalid and mismatched EC keys", async () => {
  const clientKeys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  const wrongCurve = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const options = {
    clientId: "client-id",
    clientSecret: clientKeys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
    clusterDomain: "cluster.example.rstream.test",
    projectEndpoint: "project-endpoint",
  };
  await assert.rejects(
    () =>
      createAPPTURNCredentials({
        ...options,
        serverPublicKeyHex: "00",
      }),
    /invalid DER public key/,
  );
  await assert.rejects(
    () =>
      createAPPTURNCredentials({
        ...options,
        serverPublicKeyHex: rsa.publicKey
          .export({ type: "spki", format: "der" })
          .toString("hex"),
      }),
    /must be an EC key/,
  );
  await assert.rejects(
    () =>
      createAPPTURNCredentials({
        ...options,
        serverPublicKeyHex: wrongCurve.publicKey
          .export({ type: "spki", format: "der" })
          .toString("hex"),
      }),
    /same named curve/,
  );
  await assert.rejects(
    () =>
      createAPPTURNCredentials({
        ...options,
        clientSecret: "00",
        serverPublicKeyHex: wrongCurve.publicKey
          .export({ type: "spki", format: "der" })
          .toString("hex"),
      }),
    /invalid private key/,
  );
});

test("auto TURN mode falls back to the managed API for auth tokens", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      body: init.body === undefined ? undefined : String(init.body),
      contentType: init.headers.get("Content-Type"),
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
        authorization: `Bearer ${createPATToken({ type: "auth" })}`,
        body: undefined,
        contentType: null,
        method: "POST",
        url: "https://rstream.io/api/projects/tunnels/resolve/project-endpoint/turn-server/credentials",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("auto TURN API mode forwards the requested TTL", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      body: String(init.body),
      contentType: init.headers.get("Content-Type"),
      method: init.method,
      url: input.toString(),
    });
    return new Response(
      JSON.stringify({
        credential: "cred",
        ttl: 120,
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
    await createTURNCredentials({
      apiUrl: "https://rstream.io",
      credentials: { token: createPATToken({ type: "auth" }) },
      projectEndpoint: "project-endpoint",
      ttlSeconds: 120,
    });
    assert.deepEqual(calls, [
      {
        authorization: `Bearer ${createPATToken({ type: "auth" })}`,
        body: '{"ttlSeconds":120}',
        contentType: "application/json",
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
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    serverPublicKeyHex: serverKeys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("hex"),
    ttlSeconds: 3600,
    turnDomain: "regional.example.rstream.test",
    turnRealm: "global.example.rstream.test",
  });
  assert.equal(
    credentials.username,
    "v1:1700003600:app:project-endpoint:client-id",
  );
  assert.deepEqual(credentials.urls, [
    "turn:regional.example.rstream.test:3478?transport=udp",
    "turn:regional.example.rstream.test:3478?transport=tcp",
    "turns:regional.example.rstream.test:5349?transport=udp",
    "turns:regional.example.rstream.test:5349?transport=tcp",
  ]);
});

test("TURN resource derives PAT credentials from the client configuration", async () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        deployment: "shared",
        domain: "regional.example.rstream.test",
        endpoint: "project-endpoint",
        enginePort: 443,
        id: "project-id",
        name: "Project",
        plan: "pro",
        provider: "aws",
        region: "eu-west-3",
        regionalEndpoints: [],
        routing: "regional",
        status: "active",
        turnDomain: "regional.example.rstream.test",
        turnPort: 3478,
        turnRealm: "global.example.rstream.test",
        turnsPort: 5349,
        url: "project-endpoint.regional.example.rstream.test:443",
        workspaceId: "workspace-id",
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token },
      projectEndpoint: "project-endpoint",
    });
    const credentials = await client.turn.createCredentials({
      mode: "pat",
      now: 1_700_000_000,
      ttlSeconds: 3600,
    });
    assert.equal(
      credentials.username,
      "v1:1700003600:pat:project-endpoint:1a2b3c4d",
    );
    assert.deepEqual(credentials.urls, [
      "turn:regional.example.rstream.test:3478?transport=udp",
      "turn:regional.example.rstream.test:3478?transport=tcp",
      "turns:regional.example.rstream.test:5349?transport=udp",
      "turns:regional.example.rstream.test:5349?transport=tcp",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("TURN resource refuses managed local derivation when project metadata omits the realm", async () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        deployment: "shared",
        domain: "regional.example.rstream.test",
        endpoint: "project-endpoint",
        enginePort: 443,
        id: "project-id",
        name: "Project",
        plan: "pro",
        provider: "aws",
        region: "eu-west-3",
        regionalEndpoints: [],
        routing: "regional",
        status: "active",
        turnDomain: "regional.example.rstream.test",
        turnPort: 3478,
        turnsPort: 5349,
        url: "project-endpoint.regional.example.rstream.test:443",
        workspaceId: "workspace-id",
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    );
  try {
    const client = new RstreamTunnelsClient({
      credentials: { token },
      projectEndpoint: "project-endpoint",
    });
    await assert.rejects(
      () =>
        client.turn.createCredentials({
          mode: "pat",
          now: 1_700_000_000,
          tokenEndpoint: "1a2b3c4d",
        }),
      /does not expose the TURN realm/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("local TURN derivation refuses to infer the authentication realm from the relay host", async () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  await assert.rejects(
    () =>
      createTURNCredentials({
        credentials: { token },
        engine: "project-endpoint.regional.example.rstream.test:443",
        mode: "pat",
        now: 1_700_000_000,
        projectEndpoint: "project-endpoint",
        tokenEndpoint: "1a2b3c4d",
      }),
    /TURN realm is required/,
  );
});

test("PAT TURN credentials are capped by the PAT expiration", () => {
  const token = createPATToken({
    exp: 1_700_000_120,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  const credentials = createPATTURNCredentials({
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    token,
    tokenEndpoint: "1a2b3c4d",
    ttlSeconds: 3600,
  });
  assert.equal(credentials.ttl, 120);
  assert.equal(
    credentials.username,
    "v1:1700000120:pat:project-endpoint:1a2b3c4d",
  );
});

test("TURN credentials default to a short server-compatible TTL", () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  const credentials = createPATTURNCredentials({
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    token,
    tokenEndpoint: "1a2b3c4d",
  });
  assert.equal(credentials.ttl, 600);
  assert.equal(
    credentials.username,
    "v1:1700000600:pat:project-endpoint:1a2b3c4d",
  );
});

test("PAT TURN credentials reject missing or expired PAT expirations", () => {
  const baseOptions = {
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    tokenEndpoint: "1a2b3c4d",
    ttlSeconds: 3600,
  };
  assert.throws(
    () =>
      createPATTURNCredentials({
        ...baseOptions,
        token: createPATToken({
          token_endpoint: "1a2b3c4d",
          type: "pat",
        }),
      }),
    /expiration/,
  );
  assert.throws(
    () =>
      createPATTURNCredentials({
        ...baseOptions,
        token: createPATToken({
          exp: 1_700_000_000,
          token_endpoint: "1a2b3c4d",
          type: "pat",
        }),
      }),
    /non-expired/,
  );
});

test("TURN credentials reject unsafe TTL, timestamp, and port inputs", () => {
  const token = createPATToken({
    exp: 1_700_007_200,
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  const baseOptions = {
    clusterDomain: "cluster.example.rstream.test",
    now: 1_700_000_000,
    projectEndpoint: "project-endpoint",
    token,
    tokenEndpoint: "1a2b3c4d",
    ttlSeconds: 3600,
  };
  for (const ttlSeconds of [0, -1, 1.5, 3601, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        createPATTURNCredentials({
          ...baseOptions,
          ttlSeconds,
        }),
      /TURN TTL/,
    );
  }
  for (const now of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date("invalid"),
  ]) {
    assert.throws(
      () =>
        createPATTURNCredentials({
          ...baseOptions,
          now,
        }),
      /TURN timestamp/,
    );
  }
  for (const turnPort of [0, -1, 1.5, 65_536]) {
    assert.throws(
      () =>
        createPATTURNCredentials({
          ...baseOptions,
          turnPort,
        }),
      /TURN port/,
    );
  }
  for (const turnsPort of [0, -1, 1.5, 65_536]) {
    assert.throws(
      () =>
        createPATTURNCredentials({
          ...baseOptions,
          turnsPort,
        }),
      /TURNS port/,
    );
  }
});

test("API TURN credentials reject unsafe TTL before opening IO", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch should not be called for invalid TURN TTL");
  };
  try {
    await assert.rejects(
      () =>
        createTURNCredentials({
          apiUrl: "https://rstream.io",
          credentials: { token: createPATToken({ type: "auth" }) },
          projectEndpoint: "project-endpoint",
          ttlSeconds: 3601,
        }),
      /TURN TTL/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
