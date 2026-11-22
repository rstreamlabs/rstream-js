import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const npm = process.env.npm_execpath;
assert.ok(npm, "Run this check with npm run test:react-consumer");
const repository = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const temporary = mkdtempSync(path.join(tmpdir(), "rstream-react-consumer-"));

function runNpm(args, cwd) {
  const result = spawnSync(process.execPath, [npm, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, "npm process was interrupted");
  return result;
}

try {
  const packages = [
    "@rstreamlabs/react",
    "@rstreamlabs/rstream",
    "@rstreamlabs/tunnels",
    "@rstreamlabs/webtty",
    "@rstreamlabs/filesystem",
  ];
  const pack = runNpm(
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      temporary,
      ...packages.flatMap((name) => ["--workspace", name]),
    ],
    repository,
  );
  assert.equal(pack.status, 0, pack.stderr);
  const archives = JSON.parse(pack.stdout);
  assert.deepEqual(
    archives.map(({ name }) => name).sort(),
    packages.toSorted(),
  );
  // A release candidate can pin workspace versions that are not on npm yet.
  const sdkDependencies = Object.fromEntries(
    archives.map(({ name, filename }) => {
      assert.equal(typeof filename, "string");
      assert.equal(path.basename(filename), filename);
      return [name, `file:${path.join(temporary, filename)}`];
    }),
  );
  for (const version of ["18.3.1", "19.2.8", "19.3.1"]) {
    const consumer = path.join(temporary, version);
    mkdirSync(consumer);
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "rstream-react-consumer",
        version: "1.0.0",
        private: true,
        dependencies: {
          react: version,
          "react-dom": version,
          ...sdkDependencies,
        },
      }),
    );
    const install = runNpm(
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumer,
    );
    if (version === "18.3.1") {
      assert.notEqual(install.status, 0, "React 18 must fail at installation");
      assert.match(install.stderr, /ERESOLVE/);
      assert.match(install.stderr, /@rstreamlabs\/react/);
      console.log(`React ${version}: incompatible peer rejected`);
      continue;
    }
    assert.equal(install.status, 0, install.stderr);
    writeFileSync(
      path.join(consumer, "probe.cjs"),
      `const assert = require("node:assert/strict");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { createRequire } = require("node:module");
const { useRstream } = require("@rstreamlabs/react/hooks");
const sdk = createRequire(require.resolve("@rstreamlabs/react/hooks"));
assert.equal(sdk("react"), React, "SDK must use the host React instance");
function Probe() {
  useRstream();
  return React.createElement("span", null, "ready");
}
assert.equal(renderToString(React.createElement(Probe)), "<span>ready</span>");
`,
    );
    const probe = spawnSync(process.execPath, ["probe.cjs"], {
      cwd: consumer,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.ifError(probe.error);
    assert.equal(probe.signal, null);
    assert.equal(probe.status, 0, probe.stderr);
    console.log(
      `React ${version}: packaged hook renders with the host instance`,
    );
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
