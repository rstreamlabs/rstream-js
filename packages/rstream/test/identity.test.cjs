// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const contract = require("./fixtures/caller-identity-v1.json");
const { RstreamClient } = require("../dist/index.js");
const {
  callerIdentitySchema,
  parseCallerIdentity,
  whoamiSchema,
} = require("../dist/whoami.js");

test("caller identity readers satisfy the versioned cross-SDK contract", () => {
  assert.equal(contract.contractVersion, 1);
  for (const vector of contract.cases) {
    if (vector.valid)
      assert.deepEqual(
        parseCallerIdentity(vector.response).owner,
        vector.owner,
        vector.name,
      );
    else
      assert.throws(
        () => parseCallerIdentity(vector.response),
        undefined,
        vector.name,
      );
  }
});

test("identity requests the owner-aware format and preserves effective boundaries", async () => {
  const identity = {
    owner: { kind: "workspace", workspaceId: "workspace-1" },
    credentialId: "credential-1",
    name: "Acme",
    permissions: ["account.projects.read-only"],
    resources: { tunnels: { projects: ["project-1"] } },
    authExpiresAt: "2030-01-01T00:00:00.000Z",
  };
  let calls = 0;
  const client = new RstreamClient({
    apiUrl: "https://rstream.example",
    credentials: { token: "test-token" },
    fetch: async (url, options) => {
      calls += 1;
      assert.equal(
        String(url),
        "https://rstream.example/api/whoami?format=identity",
      );
      assert.equal(options.headers.get("Authorization"), "Bearer test-token");
      return Response.json(identity);
    },
  });
  assert.deepEqual(await client.identity(), identity);
  assert.equal(calls, 1);
  assert.equal(whoamiSchema.safeParse(identity).success, false);
});

test("new identity readers accept historical personal server responses", async () => {
  const personal = {
    id: "user-1",
    role: "user",
    name: "Alice",
    permissions: [],
  };
  const client = new RstreamClient({
    apiUrl: "https://rstream.example",
    fetch: async () => Response.json(personal),
  });
  assert.deepEqual(await client.whoami(), personal);
  assert.deepEqual(await client.identity(), {
    owner: { kind: "user", userId: "user-1" },
    role: "user",
    name: "Alice",
    email: undefined,
    permissions: [],
  });
});

test("explicit workspace identity cannot masquerade as a user or omit authority", () => {
  const identity = {
    owner: { kind: "workspace", workspaceId: "workspace-1" },
    credentialId: "credential-1",
    permissions: [],
  };
  for (const extra of [
    {
      owner: {
        kind: "workspace",
        workspaceId: "workspace-1",
        userId: "user-1",
      },
    },
    { owner: { kind: "workspace", workspaceId: " workspace-1" } },
    { credentialId: undefined },
    { permissions: undefined },
    { role: "admin" },
    { email: "creator@example.test" },
  ]) {
    const malformed = { ...identity, ...extra };
    assert.throws(() => parseCallerIdentity(malformed));
  }
  assert.throws(() =>
    parseCallerIdentity({
      id: "user-1",
      role: "user",
      owner: { kind: "workspace", workspaceId: "workspace-1" },
    }),
  );
  assert.deepEqual(callerIdentitySchema.parse(identity).permissions, []);
});
