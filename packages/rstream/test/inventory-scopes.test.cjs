// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const { authTokenResourcesSchema } = require("../dist/auth-token.js");

for (const category of ["clients", "tunnels"]) {
  const resources = (list) => ({
    tunnels: { projects: ["project-id"], scopes: { [category]: { list } } },
  });

  test(`${category} listing accepts symmetric filters and selections`, () => {
    for (const list of [true, false, {}, { select: {} }, {
      filters: { AND: [
        { status: "online" },
        { OR: [{ id: { oneof: ["a", "b"] } }, { labels: { env: { regex: "^prod" } } }] },
      ] },
      select: { id: true, labels: true, project_id: false },
    }]) {
      assert.deepEqual(authTokenResourcesSchema.parse(resources(list)), resources(list));
    }
  });

  test(`${category} listing rejects malformed and unknown authorization fields`, () => {
    for (const list of [null, "true", [], 0, { unknown: true },
      { filters: { unknown: "value" } }, { filters: { OR: [] } },
      { filters: { AND: [] } }, { filters: { OR: null } },
      { select: { unknown: true } }, { select: { id: null } },
      { select: { id: "true" } },
    ]) {
      assert.equal(authTokenResourcesSchema.safeParse(resources(list)).success, false, JSON.stringify(list));
    }
  });
}

test("client listing is optional on legacy credentials but explicit client scopes require list", () => {
  assert.equal(authTokenResourcesSchema.safeParse({ tunnels: { scopes: { tunnels: { list: true } } } }).success, true);
  for (const clients of [{}, { create: true }, { connect: true }, null]) {
    assert.equal(authTokenResourcesSchema.safeParse({ tunnels: { scopes: { clients } } }).success, false);
  }
  const resource = { tunnels: { AND: [
    { projects: ["project-id"] },
    { scopes: { clients: { list: false }, tunnels: { list: true } } },
  ] } };
  assert.deepEqual(authTokenResourcesSchema.parse(resource), resource);
});
