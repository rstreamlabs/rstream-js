// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const vectors = require("./fixtures/credential-owner-v1.json");
const {
  credentialOwnerFromColumns,
  credentialOwnerSchema,
  credentialOwnersEqual,
} = require("../dist/credential-owner.js");
const {
  authTokenSchema,
  credentialAuthTokenSchema,
} = require("../dist/auth-token.js");

for (const vector of vectors.owners) {
  test(`credential owner: ${vector.name}`, () => {
    assert.deepEqual(credentialOwnerFromColumns(vector.columns), vector.owner);
  });
}

for (const vector of vectors.tokens) {
  test(`identity contract: ${vector.name}`, () => {
    assert.equal(
      credentialAuthTokenSchema.safeParse(vector.claims).success,
      vector.valid,
    );
  });
}

test("owner identifiers are qualified by their owner kind", () => {
  const user = { kind: "user", userId: "same-id" };
  const workspace = { kind: "workspace", workspaceId: "same-id" };
  assert.equal(credentialOwnersEqual(user, workspace), false);
  assert.equal(credentialOwnersEqual(workspace, workspace), true);
  assert.equal(
    credentialOwnersEqual(user, { ...user, userId: "other" }),
    false,
  );
});

test("owner input cannot add a second owner or creator authority", () => {
  for (const input of [
    { kind: "user", userId: "user-1", workspaceId: "workspace-1" },
    { kind: "workspace", workspaceId: "workspace-1", userId: "user-1" },
    {
      kind: "workspace",
      workspaceId: "workspace-1",
      createdByUserId: "user-1",
    },
  ]) {
    assert.equal(credentialOwnerSchema.safeParse(input).success, false);
  }
});

test("workspace identity cannot be injected into a native app or PAT proof", () => {
  for (const claims of [
    { type: "pat", ownerWorkspaceId: "workspace-1" },
    {
      type: "app",
      clientId: "client-1",
      permissions: null,
      ownerWorkspaceId: "workspace-1",
    },
  ]) {
    assert.equal(authTokenSchema.safeParse(claims).success, false);
  }
});

test("legacy readers retain their personal-only derived proof contract", () => {
  const workspace = vectors.tokens.find(
    (vector) => vector.name === "bounded workspace delegation",
  );
  assert.equal(authTokenSchema.safeParse(workspace.claims).success, false);
  for (const vector of vectors.tokens.filter((vector) =>
    vector.name.startsWith("legacy"),
  )) {
    assert.equal(authTokenSchema.safeParse(vector.claims).success, true);
  }
});
