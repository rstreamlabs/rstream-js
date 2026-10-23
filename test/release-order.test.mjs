import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import test from "node:test";
import { orderReleasePackages } from "../.github/scripts/order-npm-release.mjs";

const entry = (name) => ({ name, version: "1.0.0" });
const names = (entries) => entries.map((value) => value.name);
const manifest = (name, dependencies = {}) => ({
  ...entry(name),
  dependencies,
});

test("the actual SDK batch publishes dependencies before React and runtime", () => {
  const batch = ["filesystem", "react", "rstream", "runtime", "tunnels"].map(
    (name) => {
      const directory = `packages/${name}`;
      const info = JSON.parse(
        readFileSync(`${directory}/package.json`, "utf8"),
      );
      return { name: info.name, version: info.version, directory };
    },
  );
  assert.deepEqual(names(orderReleasePackages(batch)), [
    "@rstreamlabs/filesystem",
    "@rstreamlabs/rstream",
    "@rstreamlabs/tunnels",
    "@rstreamlabs/react",
    "@rstreamlabs/runtime",
  ]);
});

test("transitive, optional and peer dependencies in the batch precede consumers", () => {
  const manifests = new Map([
    [
      "app",
      {
        ...manifest("app", { core: "1.0.0" }),
        optionalDependencies: { optional: "1.0.0" },
        peerDependencies: { peer: "1.0.0" },
      },
    ],
    ["core", manifest("core", { base: "1.0.0" })],
    ["base", manifest("base")],
    ["optional", manifest("optional")],
    ["peer", manifest("peer")],
  ]);
  const batch = [...manifests.keys()].map(entry);
  const before = structuredClone(batch);
  assert.deepEqual(
    names(orderReleasePackages(batch, (value) => manifests.get(value.name))),
    ["base", "core", "optional", "peer", "app"],
  );
  assert.deepEqual(batch, before);
});

test("published dependencies outside the batch do not enter the release", () => {
  assert.deepEqual(
    names(
      orderReleasePackages([entry("app")], () =>
        manifest("app", { published: "^1.0.0" }),
      ),
    ),
    ["app"],
  );
});

test("independent packages have a stable order regardless of plan order", () => {
  const load = (value) => manifest(value.name);
  assert.deepEqual(
    names(orderReleasePackages([entry("z"), entry("a")], load)),
    ["a", "z"],
  );
  assert.deepEqual(
    names(orderReleasePackages([entry("a"), entry("z")], load)),
    ["a", "z"],
  );
});

test("duplicate names, cycles and source version mismatches are rejected", () => {
  assert.throws(
    () => orderReleasePackages([entry("a"), entry("a")]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      orderReleasePackages([entry("a"), entry("b")], (value) =>
        manifest(value.name, { [value.name === "a" ? "b" : "a"]: "1.0.0" }),
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      orderReleasePackages([entry("a")], () => ({
        ...manifest("a"),
        version: "2.0.0",
      })),
    /2.0.0/,
  );
});

test(
  "a malformed dependency graph fails before any npm operation",
  { skip: process.platform === "win32" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "rstream-release-order-"));
    const source = "a".repeat(40);
    try {
      mkdirSync(join(directory, ".github/scripts"), { recursive: true });
      mkdirSync(join(directory, "packages/a"), { recursive: true });
      mkdirSync(join(directory, "candidate"));
      mkdirSync(join(directory, "bin"));
      writeFileSync(
        join(directory, ".github/scripts/order-npm-release.mjs"),
        readFileSync(resolve(".github/scripts/order-npm-release.mjs")),
      );
      writeFileSync(
        join(directory, "packages/a/package.json"),
        JSON.stringify(manifest("a", { a: "1.0.0" })),
      );
      writeFileSync(
        join(directory, "candidate/release.json"),
        JSON.stringify({
          source,
          packages: [{ ...entry("a"), directory: "packages/a" }],
        }),
      );
      writeFileSync(
        join(directory, "bin/git"),
        `#!/bin/sh\nprintf '%s\\n' '${source}'\n`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(directory, "bin/npm"),
        "#!/bin/sh\ntouch npm-called\nexit 1\n",
        { mode: 0o755 },
      );
      const result = spawnSync(
        "bash",
        [resolve(".github/scripts/publish-npm-release.sh"), "candidate"],
        {
          cwd: directory,
          env: {
            ...process.env,
            PATH: `${join(directory, "bin")}:${process.env.PATH}`,
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Release dependency cycle/);
      assert.equal(existsSync(join(directory, "npm-called")), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
