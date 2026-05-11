// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createClientCredentialsToken,
  credentialsSchema,
  resolveAPIURL,
  tokenCredentialsSchema,
} = require("../dist/index.js");

function createClientCredentials() {
  const keys = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-521",
  });
  return {
    clientId: "client-id",
    clientSecret: keys.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("hex"),
  };
}

function decodePart(token, index) {
  return JSON.parse(
    Buffer.from(token.split(".")[index], "base64url").toString(),
  );
}

function withFrozenNow(seconds, fn) {
  const previousNow = Date.now;
  Date.now = () => seconds * 1000;
  try {
    return fn();
  } finally {
    Date.now = previousNow;
  }
}

test("credential schemas trim tokens and reject empty secrets", () => {
  assert.deepEqual(tokenCredentialsSchema.parse({ token: " token " }), {
    token: "token",
  });
  assert.equal(credentialsSchema.safeParse({ token: " " }).success, false);
  assert.equal(
    credentialsSchema.safeParse({ clientId: "client-id", clientSecret: "" })
      .success,
    false,
  );
});

test("client credentials tokens are ES512 app tokens with bounded claims", () => {
  const token = withFrozenNow(1_700_000_000, () =>
    createClientCredentialsToken(createClientCredentials(), {
      claims: {
        metadata: { engine: "edge.example.test" },
        permissions: null,
        tunnelsGrants: [
          {
            projects: ["project-id"],
            scopes: {
              tunnels: {
                list: true,
              },
            },
          },
        ],
      },
      expiresInSeconds: 120,
    }),
  ).token;
  const header = decodePart(token, 0);
  const payload = decodePart(token, 1);
  assert.equal(header.alg, "ES512");
  assert.equal(payload.type, "app");
    assert.equal(payload.clientId, "client-id");
    assert.deepEqual(payload.metadata, { engine: "edge.example.test" });
    assert.equal(payload.permissions, null);
    assert.deepEqual(payload.tunnelsGrants, [
      {
        projects: ["project-id"],
        scopes: {
          tunnels: {
            list: true,
          },
        },
      },
    ]);
  assert.equal(payload.iat, 1_700_000_000);
  assert.equal(payload.exp, 1_700_000_120);
});

test("client credentials token creation refuses unsafe token lifetimes", () => {
  const credentials = createClientCredentials();
  for (const expiresInSeconds of [0, -1, 1.5, 3601, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createClientCredentialsToken(credentials, { expiresInSeconds }),
      /expiresInSeconds/,
    );
  }
  assert.throws(
    () =>
      createClientCredentialsToken(credentials, {
        issuedAt: Number.POSITIVE_INFINITY,
      }),
    /safe integer/,
  );
  assert.throws(
    () =>
      createClientCredentialsToken(credentials, {
        issuedAt: Date.now(),
      }),
    /current time/,
  );
  assert.throws(
    () =>
      createClientCredentialsToken(credentials, {
        issuedAt: Math.floor(Date.now() / 1000) + 301,
      }),
    /current time/,
  );
});

test("client credentials token creation rejects reserved and unknown claims", () => {
  const credentials = createClientCredentials();
  for (const claims of [
    { exp: 9999999999 },
    { iat: 1 },
    { clientId: "other-client" },
    { type: "auth" },
    { token_endpoint: "1a2b3c4d" },
    { permissions: [" "] },
    { tunnelsGrants: [] },
    { tunnelsGrants: [{}] },
    { tunnelsGrants: [{ projects: ["project-id"] }] },
    { tunnelsGrants: [{ projects: [] }] },
    {
      tunnelsGrants: [
        {
          projects: ["project-id"],
          scopes: { tunnels: { list: true } },
          workspaces: ["ws-id"],
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-id"],
          extra: true,
          scopes: { tunnels: { list: true } },
        },
      ],
    },
    {
      tunnelsGrants: [
        {
          projects: ["project-id"],
          scopes: { tunnels: { delete: true } },
        },
      ],
    },
    { metadata: { engine: "edge.example.test", extra: true } },
  ]) {
    assert.throws(
      () => createClientCredentialsToken(credentials, { claims }),
      /Unrecognized key|Too small|cannot target workspaces and projects|required|must target|expected object/,
    );
  }
});

test("API URL resolution trims explicit and environment values", () => {
  const previous = process.env.RSTREAM_API_URL;
  process.env.RSTREAM_API_URL = " https://env.example.test ";
  try {
    assert.equal(resolveAPIURL(), "https://env.example.test");
    assert.equal(
      resolveAPIURL(" https://explicit.example.test "),
      "https://explicit.example.test",
    );
  } finally {
    if (previous === undefined) delete process.env.RSTREAM_API_URL;
    else process.env.RSTREAM_API_URL = previous;
  }
});

test("API URL resolution falls back outside Node-like environments", () => {
  const previousProcess = global.process;
  try {
    delete global.process;
    assert.equal(resolveAPIURL(), "https://rstream.io");
  } finally {
    global.process = previousProcess;
  }
});
