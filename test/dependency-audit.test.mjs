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
function inputs() {
  return {
    full: structuredClone(full),
    production: structuredClone(production),
    options: { fullStatus: 1, productionStatus: 0 },
  };
}
function execute(input) {
  return evaluate(input.full, input.production, input.options);
}
test("rejects the formerly excepted development advisory", () => {
  assert.throws(
    () => execute(inputs()),
    /development dependency vulnerability/,
  );
});
test("rejects production findings independently of the full audit", () => {
  const input = inputs();
  input.full = structuredClone(production);
  input.options.fullStatus = 0;
  input.production = structuredClone(full);
  input.options.productionStatus = 1;
  assert.throws(() => execute(input), /production dependency vulnerability/);
});
test("a clean audit passes", () => {
  assert.deepEqual(evaluate(production, production), { accepted: true });
});
for (const [label, mutate] of [
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
]) {
  test("rejects " + label, () => {
    const input = inputs();
    mutate(input);
    assert.throws(() => execute(input));
  });
}
test("critical findings fail even when development-only", () => {
  const input = inputs();
  input.full.vulnerabilities.braces.severity = "critical";
  input.full.metadata.vulnerabilities.high--;
  input.full.metadata.vulnerabilities.critical++;
  assert.throws(() => execute(input), /development dependency vulnerability/);
});
test("null and non-JSON-shaped output fail closed", () => {
  for (const input of [null, [], "", { error: { code: "ENOTFOUND" } }])
    assert.throws(() => validateReport(input, 1));
});
