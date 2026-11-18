// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const test = require("node:test");
const z = require("zod");
const { authTokenResourcesSchema } = require("../dist/auth-token.js");
const { filterRecordKeySchema, filters } = require("../dist/zod.js");

test("filter record keys that would be silently omitted fail closed at any filter depth", () => {
  for (const filter of [
    JSON.parse('{"labels":{"__proto__":"camera"}}'),
    JSON.parse(
      '{"labels":{"device":"camera","__proto__":{"exact":"required"}}}',
    ),
    {
      AND: [
        JSON.parse('{"labels":{"__proto__":"camera"}}'),
        { labels: { site: "atelier" } },
      ],
    },
    {
      OR: [
        { labels: { site: "atelier" } },
        JSON.parse('{"labels":{"__proto__":"camera"}}'),
      ],
    },
  ]) {
    const result = authTokenResourcesSchema.safeParse({
      tunnels: { scopes: { tunnels: { create: { filters: filter } } } },
    });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.length > 0);
    assert.doesNotThrow(() => z.treeifyError(result.error));
  }
  assert.equal(filterRecordKeySchema.safeParse("__proto__").success, false);
});

test("filter JSON Schema describes the same record key boundary and preserves existing key checks", () => {
  const schema = filters(
    z.object({ labels: z.record(z.string().min(2), z.string()) }),
  );
  const json = z.toJSONSchema(schema, { unrepresentable: "any" });
  const keys = json.anyOf[0].properties.labels.propertyNames;
  assert.equal(keys.minLength, 2);
  const pattern = new RegExp(keys.pattern);
  assert.equal(pattern.test("__proto__"), false);
  assert.equal(pattern.test("constructor"), true);
  assert.equal(schema.safeParse({ labels: { x: "camera" } }).success, false);
  assert.deepEqual(schema.parse({ labels: { device: "camera" } }), {
    labels: { device: "camera" },
  });
});

test("ordinary filter keys retain their constraints, including prototype and constructor labels", () => {
  const resources = {
    tunnels: {
      scopes: {
        tunnels: {
          create: {
            filters: {
              labels: {
                device: "camera",
                prototype: "literal",
                constructor: "literal",
              },
            },
          },
        },
      },
    },
  };
  assert.deepEqual(authTokenResourcesSchema.parse(resources), resources);
  assert.equal(filterRecordKeySchema.safeParse("constructor").success, true);
  assert.equal(filterRecordKeySchema.safeParse("prototype").success, true);
});
