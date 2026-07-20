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

function restoreRegionEnv(previous) {
  if (previous === undefined) {
    delete process.env.RSTREAM_REGION;
  } else {
    process.env.RSTREAM_REGION = previous;
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
      bypass: init.headers.get("X-Deployment-Bypass"),
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
      controlPlaneHeaders: { "X-Deployment-Bypass": "secret" },
      projectEndpoint: " project-endpoint ",
    });
    assert.equal(engine, "project-endpoint.cluster.example.rstream.test:8443");
    assert.deepEqual(calls, [
      {
        authorization: "Bearer control-plane-token",
        bypass: "secret",
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

test("managed project resolution selects only an authorized region", async () => {
  const previousEngine = process.env.RSTREAM_ENGINE;
  const previousRegion = process.env.RSTREAM_REGION;
  const previousToken = process.env.RSTREAM_AUTHENTICATION_TOKEN;
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        deployment: "shared",
        domain: "global.example.test",
        endpoint: "project-endpoint",
        enginePort: 443,
        id: "project-id",
        name: "Global",
        placement: "global",
        plan: "pro",
        provider: "other",
        regionalEndpoints: [
          {
            domain: "eu.example.test",
            enginePort: 8443,
            provider: "aws",
            region: "eu-west-3",
          },
          {
            domain: "us.example.test",
            enginePort: 443,
            provider: "aws",
            region: "us-east-1",
          },
        ],
        status: "active",
        turnPort: 3478,
        turnsPort: 5349,
        url: "project-endpoint.global.example.test:443",
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
    delete process.env.RSTREAM_REGION;
    delete process.env.RSTREAM_AUTHENTICATION_TOKEN;
    assert.equal(
      await resolveTunnelsEngine({
        controlPlaneCredentials: { token: "token" },
        projectEndpoint: "project-endpoint",
        region: "US-EAST-1",
      }),
      "project-endpoint.us.example.test:443",
    );
    await assert.rejects(
      () =>
        resolveTunnelsEngine({
          controlPlaneCredentials: { token: "token" },
          projectEndpoint: "project-endpoint",
          region: "ap-southeast-1",
        }),
      /Available regions: eu-west-3, us-east-1/,
    );
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEngine);
    restoreRegionEnv(previousRegion);
    restoreTokenEnv(previousToken);
  }
});

test("region selection rejects direct engine overrides before IO", async () => {
  const previousEngine = process.env.RSTREAM_ENGINE;
  const previousRegion = process.env.RSTREAM_REGION;
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    delete process.env.RSTREAM_ENGINE;
    delete process.env.RSTREAM_REGION;
    await assert.rejects(
      () =>
        resolveTunnelsEngine({
          controlPlaneCredentials: { token: "token" },
          engine: "engine.example.test:443",
          projectEndpoint: "project-endpoint",
          region: "eu-west-3",
        }),
      /cannot be combined with an explicit engine override/,
    );
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(previousEngine);
    restoreRegionEnv(previousRegion);
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
