// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const { getTunnelsProjectEngine } = require("../dist/index.js");
const { RstreamClient } = require("../dist/index.js");

function projectResponse(overrides = {}) {
  return {
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
    ...overrides,
  };
}

test("tunnels projects list encodes normalized query params", async () => {
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
        page: 2,
        pageSize: 25,
        projects: [projectResponse()],
        total: 1,
        totalPages: 1,
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
    const projects = await client.tunnels.projects.list({
      order: "desc",
      page: 2,
      pageSize: 25,
      q: " prod ",
      sort: "name",
    });
    assert.equal(projects.projects.length, 1);
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "GET",
        url: "https://rstream.io/api/projects/tunnels?q=prod&page=2&pageSize=25&sort=name&order=desc",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("project endpoint resolution trims and encodes the endpoint", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    return new Response(JSON.stringify(projectResponse()), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
    });
    const project =
      await client.tunnels.projects.resolveByEndpoint(" project/tenant ");
    assert.equal(project.id, "project-id");
    assert.deepEqual(calls, [
      {
        authorization: "Bearer token",
        method: "GET",
        url: "https://rstream.io/api/projects/tunnels/resolve/project%2Ftenant",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("project endpoint methods reject blank identifiers before IO", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    calls.push(input.toString());
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
    });
    await assert.rejects(
      () => client.tunnels.projects.resolveByEndpoint(" "),
      /Project endpoint is required/,
    );
    await assert.rejects(
      () => client.tunnels.projects.createTurnCredentials(" "),
      /Project ID is required/,
    );
    await assert.rejects(
      () => client.tunnels.projects.createTurnCredentialsByEndpoint(" "),
      /Project endpoint is required/,
    );
    assert.deepEqual(calls, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("getTunnelsProjectEngine prefers structured endpoint fields", () => {
  assert.equal(
    getTunnelsProjectEngine(projectResponse()),
    "project-endpoint.cluster.example.rstream.test:8443",
  );
  assert.equal(
    getTunnelsProjectEngine(
      projectResponse({
        domain: "",
        endpoint: "",
        url: "legacy.example.test",
      }),
    ),
    "legacy.example.test:443",
  );
  assert.equal(
    getTunnelsProjectEngine(
      projectResponse({
        domain: "",
        endpoint: "",
        url: "",
      }),
    ),
    undefined,
  );
  assert.throws(
    () =>
      getTunnelsProjectEngine(
        projectResponse({
          domain: "cluster.example.rstream.test/path",
        }),
      ),
    /Project domain/,
  );
  assert.throws(
    () =>
      getTunnelsProjectEngine(
        projectResponse({
          domain: "",
          endpoint: "",
          url: "https://legacy.example.test/path",
        }),
      ),
    /Project URL/,
  );
});

test("control-plane requests surface HTTP errors without credentials", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      authorization: init.headers.get("Authorization"),
      method: init.method,
      url: input.toString(),
    });
    return new Response("denied", { status: 403 });
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
    });
    assert.equal(await client.getToken(), undefined);
    await assert.rejects(
      () =>
        client.request("/api/private", {
          method: "GET",
        }),
      /HTTP error 403: denied/,
    );
    assert.deepEqual(calls, [
      {
        authorization: null,
        method: "GET",
        url: "https://rstream.io/api/private",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("control-plane request helper rejects cross-origin paths before auth", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    calls.push(input.toString());
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      credentials: { token: "token" },
    });
    await assert.rejects(
      () => client.request("https://evil.example.test/api/private"),
      /relative absolute path/,
    );
    await assert.rejects(
      () => client.request("//evil.example.test/api/private"),
      /relative absolute path/,
    );
    assert.deepEqual(calls, []);
  } finally {
    global.fetch = originalFetch;
  }
});
