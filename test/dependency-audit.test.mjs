import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluate,
  validateReport,
} from "../.github/scripts/dependency-audit.mjs";

const full = JSON.parse(
  readFileSync(
    new URL("./fixtures/dependency-audit-full.json", import.meta.url),
  ),
);
const production = JSON.parse(
  readFileSync(
    new URL("./fixtures/dependency-audit-production.json", import.meta.url),
  ),
);
const versions = [
  ["@next/eslint-plugin-next", "16.4.0", "fast-glob"],
  ["fast-glob", "3.3.1", "micromatch"],
  ["micromatch", "4.0.8", "braces"],
  ["braces", "3.0.3"],
];
function inputs() {
  return {
    full: structuredClone(full),
    production: structuredClone(production),
    lock: {
      lockfileVersion: 3,
      packages: Object.fromEntries(
        versions.map(([name, version, next]) => [
          "node_modules/" + name,
          { version, dev: true, dependencies: next ? { [next]: "*" } : {} },
        ]),
      ),
    },
    options: {
      fullStatus: 1,
      productionStatus: 0,
      now: new Date("2026-10-11T00:00:00Z"),
    },
  };
}
function execute(input) {
  return evaluate(input.full, input.production, input.lock, input.options);
}
test("only the approved development advisory is accepted before expiry", () => {
  assert.equal(execute(inputs()).exceptionUsed, true);
});
for (const [label, mutate] of [
  [
    "expiry boundary",
    (x) => {
      x.options.now = new Date("2026-11-09T00:00:00Z");
    },
  ],
  [
    "invalid clock",
    (x) => {
      x.options.now = new Date("invalid");
    },
  ],
  [
    "different advisory",
    (x) => {
      x.full.vulnerabilities.braces.via[0].url =
        "https://github.com/advisories/GHSA-new";
    },
  ],
  [
    "extra advisory",
    (x) => {
      x.full.vulnerabilities.braces.via.push({
        ...x.full.vulnerabilities.braces.via[0],
        url: "other",
      });
    },
  ],
  [
    "critical severity",
    (x) => {
      x.full.vulnerabilities.braces.severity = "critical";
      x.full.metadata.vulnerabilities.high--;
      x.full.metadata.vulnerabilities.critical++;
    },
  ],
  [
    "production scope",
    (x) => {
      x.lock.packages["node_modules/braces"].dev = false;
    },
  ],
  [
    "production finding",
    (x) => {
      x.production = structuredClone(x.full);
      x.options.productionStatus = 1;
    },
  ],
  [
    "different installed version",
    (x) => {
      x.lock.packages["node_modules/braces"].version = "3.0.2";
    },
  ],
  [
    "additional installed copy",
    (x) => {
      x.lock.packages["node_modules/other/node_modules/braces"] =
        x.lock.packages["node_modules/braces"];
    },
  ],
  [
    "changed dependency chain",
    (x) => {
      x.full.vulnerabilities.braces.effects.push("another-package");
    },
  ],
  [
    "changed lock chain",
    (x) => {
      delete x.lock.packages["node_modules/micromatch"].dependencies.braces;
    },
  ],
  [
    "missing lock",
    (x) => {
      x.lock = null;
    },
  ],
  [
    "missing audit entries",
    (x) => {
      delete x.full.vulnerabilities;
    },
  ],
  [
    "unsupported audit schema",
    (x) => {
      x.full.auditReportVersion = 3;
    },
  ],
  [
    "npm transport error",
    (x) => {
      x.full.error = { code: "ENOTFOUND" };
    },
  ],
  [
    "incorrect audit counts",
    (x) => {
      x.full.metadata.vulnerabilities.high = 0;
    },
  ],
  [
    "incorrect process status",
    (x) => {
      x.options.fullStatus = 0;
    },
  ],
  [
    "new vulnerable package",
    (x) => {
      x.full.vulnerabilities.new = {
        ...x.full.vulnerabilities.braces,
        name: "new",
      };
      x.full.metadata.vulnerabilities.high++;
      x.full.metadata.vulnerabilities.total++;
    },
  ],
]) {
  test("rejects " + label, () => {
    const input = inputs();
    mutate(input);
    assert.throws(() => execute(input));
  });
}
test("a clean audit needs no exception, including after expiry", () => {
  const input = inputs();
  input.full = structuredClone(production);
  input.options.fullStatus = 0;
  input.options.now = new Date("2027-01-01T00:00:00Z");
  assert.deepEqual(execute(input), { accepted: true, exceptionUsed: false });
});
test("null and non-JSON-shaped output fail closed", () => {
  for (const input of [null, [], "", { error: { code: "ENOTFOUND" } }])
    assert.throws(() => validateReport(input, 1));
});
