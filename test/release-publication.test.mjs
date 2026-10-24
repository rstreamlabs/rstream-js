import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import test from "node:test";

function publish(mode) {
  const directory = mkdtempSync(join(tmpdir(), "rstream-publication-"));
  const source = "a".repeat(40);
  const archive = Buffer.from("immutable release archive");
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  try {
    for (const name of [".github/scripts", "packages/a", "candidate", "bin"]) {
      mkdirSync(join(directory, name), { recursive: true });
    }
    writeFileSync(
      join(directory, ".github/scripts/order-npm-release.mjs"),
      readFileSync(resolve(".github/scripts/order-npm-release.mjs")),
    );
    writeFileSync(
      join(directory, "packages/a/package.json"),
      JSON.stringify({ name: "a", version: "1.0.0" }),
    );
    writeFileSync(join(directory, "candidate/a.tgz"), archive);
    writeFileSync(
      join(directory, "candidate/release.json"),
      JSON.stringify({
        source,
        packages: [
          {
            name: "a",
            version: "1.0.0",
            directory: "packages/a",
            archive: "a.tgz",
            integrity,
          },
        ],
      }),
    );
    writeFileSync(
      join(directory, "bin/git"),
      `#!/bin/sh\nprintf '%s\\n' '${source}'\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(directory, "bin/sleep"),
      "#!/bin/sh\nprintf '%s\\n' \"$1\" >> sleeps\n",
      { mode: 0o755 },
    );
    writeFileSync(
      join(directory, "state.json"),
      JSON.stringify({
        mode,
        integrity,
        views: 0,
        postPublishViews: 0,
        publishes: 0,
        freshReads: 0,
      }),
    );
    writeFileSync(
      join(directory, "bin/npm"),
      `#!/usr/bin/env node
const fs = require("node:fs");
const s = JSON.parse(fs.readFileSync("state.json", "utf8"));
const args = process.argv.slice(2);
if (args[0] === "publish") {
  s.publishes += 1;
  fs.writeFileSync("state.json", JSON.stringify(s));
  process.exit(0);
}
if (args[0] !== "view") process.exit(9);
s.views += 1;
if (args.includes("--prefer-online")) s.freshReads += 1;
if (s.publishes) s.postPublishViews += 1;
fs.writeFileSync("state.json", JSON.stringify(s));
if (s.mode === "already") { console.log(s.integrity); process.exit(0); }
if (s.mode === "conflict" || (s.mode === "post-conflict" && s.publishes)) {
  console.log("sha512-different"); process.exit(0);
}
if (s.mode === "auth" || (s.mode === "post-auth" && s.publishes)) {
  console.error("npm error E401 Unauthorized"); process.exit(1);
}
if (s.publishes && s.mode !== "unavailable" && s.postPublishViews > 30) {
  console.log(s.integrity); process.exit(0);
}
console.error("npm error E404 Not Found");
process.exit(1);
`,
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
        timeout: 20000,
      },
    );
    return {
      ...result,
      state: JSON.parse(readFileSync(join(directory, "state.json"), "utf8")),
      delays: existsSync(join(directory, "sleeps"))
        ? readFileSync(join(directory, "sleeps"), "utf8")
            .trim()
            .split("\n")
            .map(Number)
        : [],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const options = { skip: process.platform === "win32" };

test(
  "publication waits for registry processing beyond the former 24 checks",
  options,
  () => {
    const result = publish("pending");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.state.publishes, 1);
    assert.equal(result.state.postPublishViews, 31);
    assert.equal(result.state.freshReads, result.state.views);
    assert.deepEqual(result.delays.slice(0, 4), [2, 4, 8, 15]);
    assert.ok(result.delays.every((delay) => delay <= 15));
  },
);

test(
  "publication retries keep an already published matching archive immutable",
  options,
  () => {
    const result = publish("already");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.state.publishes, 0);
  },
);

test(
  "registry visibility exhaustion is bounded and distinct from an integrity conflict",
  options,
  () => {
    const result = publish("unavailable");
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.state.publishes, 1);
    assert.ok(result.state.views <= 41);
    assert.ok(result.delays.reduce((sum, delay) => sum + delay, 0) < 600);
    assert.match(result.stderr, /did not become visible/);
    assert.match(result.stderr, /same candidate/);
    assert.doesNotMatch(result.stderr, /integrity mismatch/);
  },
);

for (const mode of ["conflict", "post-conflict"]) {
  test(`publication rejects ${mode} immediately`, options, () => {
    const result = publish(mode);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.state.views <= 2);
    assert.equal(result.state.publishes, mode === "conflict" ? 0 : 1);
    assert.match(result.stderr, /integrity mismatch|immutable npm conflict/);
  });
}

for (const mode of ["auth", "post-auth"]) {
  test(
    `publication reports ${mode} without polling it as a pending package`,
    options,
    () => {
      const result = publish(mode);
      assert.equal(result.status, 1, result.stderr);
      assert.ok(result.state.views <= 2);
      assert.equal(result.state.publishes, mode === "auth" ? 0 : 1);
      assert.match(result.stderr, /E401 Unauthorized/);
    },
  );
}
