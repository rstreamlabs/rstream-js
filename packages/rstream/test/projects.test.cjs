// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");

const { getTunnelsProjectEngine } = require("../dist/index.js");
const { mergeControlPlaneHeaders } = require("../dist/index.js");
const { normalizeControlPlaneHeaders } = require("../dist/index.js");
const { RstreamClient } = require("../dist/index.js");
const { tunnelsProjectSchema } = require("../dist/index.js");

function projectResponse(overrides = {}) {
  return {
    deployment: "shared",
    domain: "cluster.example.rstream.test",
    endpoint: "project-endpoint",
    enginePort: 8443,
    id: "project-id",
    name: "Prod",
    plan: "pro",
    routing: "regional",
    provider: "aws",
    regionalEndpoints: [
      {
        domain: "cluster.example.rstream.test",
        enginePort: 8443,
        provider: "aws",
        region: "eu-west-3",
      },
    ],
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

test("project responses require an explicit routing mode", () => {
  const response = projectResponse();
  delete response.routing;
  assert.throws(() => tunnelsProjectSchema.parse(response), /routing/);
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

test("Control plane headers are validated and requests never follow redirects", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({
      bypass: init.headers.get("X-Deployment-Bypass"),
      redirect: init.redirect,
      url: input.toString(),
    });
    return new Response(JSON.stringify({ id: "user-id", role: "user" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  };
  try {
    const client = new RstreamClient({
      apiUrl: "https://rstream.io",
      controlPlaneHeaders: { "X-Deployment-Bypass": "secret" },
    });
    await client.whoami();
    assert.deepEqual(calls, [
      {
        bypass: "secret",
        redirect: "manual",
        url: "https://rstream.io/api/whoami",
      },
    ]);
    await assert.rejects(
      () =>
        new RstreamClient({
          apiUrl: "https://rstream.io",
          controlPlaneHeaders: { Authorization: "bad" },
        }).whoami(),
      /Reserved control plane header/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("Control plane header names reject ambiguous duplicates", () => {
  assert.throws(
    () =>
      normalizeControlPlaneHeaders({
        "X-Shared": "stored",
        "x-shared": "runtime",
      }),
    /Duplicate control plane header/,
  );
});

test("Control plane header sources use explicit precedence", () => {
  assert.deepEqual(
    mergeControlPlaneHeaders(
      { "X-Shared": "stored" },
      { "x-shared": "runtime" },
    ),
    { "X-Shared": "runtime" },
  );
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

test("getTunnelsProjectEngine selects only project-authorized regions", () => {
  const project = projectResponse({
    domain: "global.example.rstream.test",
    routing: "global",
    regionalEndpoints: [
      {
        domain: "eu.example.rstream.test",
        enginePort: 443,
        provider: "aws",
        region: "eu-west-3",
      },
      {
        domain: "us.example.rstream.test",
        enginePort: 8443,
        provider: "aws",
        region: "us-east-1",
      },
    ],
  });
  assert.equal(
    getTunnelsProjectEngine(project),
    "project-endpoint.global.example.rstream.test:8443",
  );
  assert.equal(
    getTunnelsProjectEngine(project, " us-east-1 "),
    "project-endpoint.us.example.rstream.test:8443",
  );
  assert.throws(
    () => getTunnelsProjectEngine(project, "ap-southeast-1"),
    /Available regions: eu-west-3, us-east-1/,
  );
  assert.throws(
    () =>
      getTunnelsProjectEngine(
        projectResponse({
          regionalEndpoints: [
            {
              domain: "first.example.test",
              enginePort: 443,
              provider: "aws",
              region: "eu-west-3",
            },
            {
              domain: "second.example.test",
              enginePort: 443,
              provider: "gcp",
              region: "eu-west-3",
            },
          ],
        }),
        "eu-west-3",
      ),
    /ambiguous/,
  );
});

test("Control plane API requests surface HTTP errors without credentials", async () => {
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

test("Control plane API request helper rejects cross-origin paths before auth", async () => {
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
