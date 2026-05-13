// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveControlPlaneCredentials,
  resolveTunnelsAPIURL,
  resolveTunnelsCredentials,
  resolveTunnelsEngine,
} = require("../dist/index.js");

function unsignedToken(payload) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function restoreEnv(previous) {
  if (previous === undefined) {
    delete process.env.RSTREAM_ENGINE;
  } else {
    process.env.RSTREAM_ENGINE = previous;
  }
}

function restoreTokenEnv(previous) {
  if (previous === undefined) {
    delete process.env.RSTREAM_AUTHENTICATION_TOKEN;
  } else {
    process.env.RSTREAM_AUTHENTICATION_TOKEN = previous;
  }
}

test("engine resolution follows explicit and environment precedence", async () => {
  const previousEngine = process.env.RSTREAM_ENGINE;
  const token = unsignedToken({
    metadata: {
      engine: " token-engine.example.test:443 ",
    },
    token_endpoint: "1a2b3c4d",
    type: "pat",
  });
  try {
    process.env.RSTREAM_ENGINE = " env-engine.example.test:443 ";
    assert.equal(
      await resolveTunnelsEngine({
        engine: " explicit-engine.example.test:443 ",
        token,
      }),
      "explicit-engine.example.test:443",
    );
    assert.equal(
      await resolveTunnelsEngine({
        token,
      }),
      "env-engine.example.test:443",
    );
    delete process.env.RSTREAM_ENGINE;
    await assert.rejects(
      () =>
        resolveTunnelsEngine({
          token,
        }),
      /Engine URL is not defined/,
    );
  } finally {
    restoreEnv(previousEngine);
  }
});

test("engine resolution ignores unverified token metadata", async () => {
  const previousEngine = process.env.RSTREAM_ENGINE;
  try {
    delete process.env.RSTREAM_ENGINE;
    await assert.rejects(
      () =>
        resolveTunnelsEngine({
          token: unsignedToken({
            metadata: {
              engine: "engine.example.test:443",
            },
            token_endpoint: "1a2b3c4d",
            type: "pat",
          }),
        }),
      /Engine URL is not defined/,
    );
  } finally {
    restoreEnv(previousEngine);
  }
});

test("managed project endpoint resolution uses Control plane API credentials", async () => {
  const previousEngine = process.env.RSTREAM_ENGINE;
  const previousToken = process.env.RSTREAM_AUTHENTICATION_TOKEN;
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
        deployment: "shared",
        domain: "cluster.example.rstream.test",
        endpoint: "project-endpoint",
        enginePort: 8443,
        id: "project-id",
        name: "Prod",
        plan: "pro",
        provider: "aws",
        status: "active",
        turnPort: 3478,
        turnsPort: 5349,
        url: "deprecated.example.test:443",
        workspaceId: "workspace-id",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      },
    );
  };
  try {
    delete process.env.RSTREAM_ENGINE;
    delete process.env.RSTREAM_AUTHENTICATION_TOKEN;
    const engine = await resolveTunnelsEngine({
      apiUrl: "https://control.example.test",
      controlPlaneCredentials: { token: "control-plane-token" },
      projectEndpoint: " project-endpoint ",
    });
    assert.equal(engine, "project-endpoint.cluster.example.rstream.test:8443");
    assert.deepEqual(calls, [
      {
        authorization: "Bearer control-plane-token",
        method: "GET",
        url: "https://control.example.test/api/projects/tunnels/resolve/project-endpoint",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEngine);
    restoreTokenEnv(previousToken);
  }
});

test("managed project endpoint resolution requires credentials before IO", async () => {
  const previousEngine = process.env.RSTREAM_ENGINE;
  const previousToken = process.env.RSTREAM_AUTHENTICATION_TOKEN;
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    calls.push(input.toString());
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    delete process.env.RSTREAM_ENGINE;
    delete process.env.RSTREAM_AUTHENTICATION_TOKEN;
    await assert.rejects(
      () =>
        resolveTunnelsEngine({
          projectEndpoint: "project-endpoint",
        }),
      /Control-plane credentials are required/,
    );
    assert.deepEqual(calls, []);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEngine);
    restoreTokenEnv(previousToken);
  }
});

test("tunnels credential resolution trims environment and honors precedence", () => {
  const previousApiURL = process.env.RSTREAM_API_URL;
  const previousToken = process.env.RSTREAM_AUTHENTICATION_TOKEN;
  try {
    process.env.RSTREAM_API_URL = " https://api.example.test ";
    process.env.RSTREAM_AUTHENTICATION_TOKEN = " environment-token ";
    assert.equal(resolveTunnelsAPIURL(), "https://api.example.test");
    assert.equal(
      resolveTunnelsAPIURL(" https://explicit.example.test "),
      "https://explicit.example.test",
    );
    assert.deepEqual(resolveTunnelsCredentials(), {
      token: "environment-token",
    });
    assert.deepEqual(resolveTunnelsCredentials({ token: "explicit-token" }), {
      token: "explicit-token",
    });
    assert.deepEqual(
      resolveControlPlaneCredentials(undefined, undefined, "auth-token"),
      { token: "auth-token" },
    );
    assert.deepEqual(
      resolveControlPlaneCredentials(
        { token: "control-token" },
        { token: "data-token" },
        "auth-token",
      ),
      { token: "control-token" },
    );
  } finally {
    if (previousApiURL === undefined) delete process.env.RSTREAM_API_URL;
    else process.env.RSTREAM_API_URL = previousApiURL;
    if (previousToken === undefined) {
      delete process.env.RSTREAM_AUTHENTICATION_TOKEN;
    } else {
      process.env.RSTREAM_AUTHENTICATION_TOKEN = previousToken;
    }
  }
});
