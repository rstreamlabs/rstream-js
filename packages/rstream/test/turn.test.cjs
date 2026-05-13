// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { RstreamClient } = require("../dist/index.js");

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

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

test("Control plane API requests support application credentials", async () => {
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
        id: "user-id",
        role: "member",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: createClientCredentials(),
    });
    const whoami = await client.whoami();
    assert.deepEqual(whoami, {
      id: "user-id",
      role: "member",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url, "https://rstream.io/api/whoami");
    const payload = decodePayload(
      calls[0].authorization.replace("Bearer ", ""),
    );
    assert.equal(payload.type, "app");
    assert.equal(payload.clientId, "client-id");
    assert.equal(payload.permissions, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("managed TURN credentials by project endpoint use the expected route", async () => {
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
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
    });
    const credentials =
      await client.tunnels.projects.createTurnCredentialsByEndpoint(
        "project-endpoint",
      );
    assert.deepEqual(credentials, {
      credential: "cred",
      ttl: 3600,
      urls: ["turn:cluster.example:3478?transport=udp"],
      username: "user",
    });
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "POST",
        url: "https://rstream.io/api/projects/tunnels/resolve/project-endpoint/turn-server/credentials",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("managed TURN credentials by project endpoint support application credentials", async () => {
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
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: createClientCredentials(),
    });
    await client.tunnels.projects.createTurnCredentialsByEndpoint(
      "project-endpoint",
    );
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://rstream.io/api/projects/tunnels/resolve/project-endpoint/turn-server/credentials",
    );
    const payload = decodePayload(
      calls[0].authorization.replace("Bearer ", ""),
    );
    assert.equal(payload.type, "app");
    assert.equal(payload.clientId, "client-id");
    assert.equal(payload.permissions, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("managed TURN credentials by project id use the expected route", async () => {
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
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
    });
    await client.tunnels.projects.createTurnCredentials("project-id");
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "POST",
        url: "https://rstream.io/api/projects/tunnels/project-id/turn-server/credentials",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
