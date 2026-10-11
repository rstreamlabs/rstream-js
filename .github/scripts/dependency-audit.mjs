// Approved, expiring development-only exception; see SECURITY.md.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const expiry = "2026-11-09T00:00:00.000Z";
const advisory = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const chain = [
  ["@next/eslint-plugin-next", "16.4.0"],
  ["fast-glob", "3.3.1"],
  ["micromatch", "4.0.8"],
  ["braces", "3.0.3"],
];
const levels = ["info", "low", "moderate", "high", "critical"];
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function requireValue(value, message) {
  if (!value) throw new Error(message);
}

export function validateReport(report, exitStatus) {
  requireValue(
    object(report) &&
      report.auditReportVersion === 2 &&
      !report.error &&
      object(report.vulnerabilities) &&
      object(report.metadata?.vulnerabilities),
    "Malformed npm audit result",
  );
  const counts = Object.fromEntries(levels.map((level) => [level, 0]));
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    requireValue(
      object(item) &&
        item.name === name &&
        levels.includes(item.severity) &&
        Array.isArray(item.via) &&
        Array.isArray(item.effects) &&
        Array.isArray(item.nodes) &&
        item.nodes.length > 0 &&
        item.nodes.every((node) => typeof node === "string"),
      "Malformed vulnerability entry",
    );
    counts[item.severity]++;
  }
  for (const level of levels) {
    requireValue(
      report.metadata.vulnerabilities[level] === counts[level],
      "Audit severity totals differ",
    );
  }
  requireValue(
    report.metadata.vulnerabilities.total ===
      Object.keys(report.vulnerabilities).length,
    "Audit vulnerability total differs",
  );
  requireValue(
    exitStatus === (counts.high + counts.critical > 0 ? 1 : 0),
    "npm audit execution failed or exit status differs",
  );
  return Object.values(report.vulnerabilities).filter((item) =>
    ["high", "critical"].includes(item.severity),
  );
}

export function evaluate(fullReport, productionReport, lock, options = {}) {
  const fullHigh = validateReport(fullReport, options.fullStatus ?? 0);
  const productionHigh = validateReport(
    productionReport,
    options.productionStatus ?? 0,
  );
  requireValue(
    productionHigh.length === 0,
    "High/critical production dependency vulnerability",
  );
  if (fullHigh.length === 0) return { accepted: true, exceptionUsed: false };
  requireValue(
    object(lock?.packages) && lock.lockfileVersion === 3,
    "Malformed npm lockfile",
  );
  const now = options.now ?? new Date();
  requireValue(
    now instanceof Date &&
      Number.isFinite(now.valueOf()) &&
      now < new Date(expiry),
    "Development exception expired",
  );
  requireValue(
    same(
      fullHigh.map((item) => item.name).sort(),
      chain.map(([name]) => name).sort(),
    ),
    "Unexpected high/critical dependency advisory",
  );
  for (const [index, [name, version]] of chain.entries()) {
    const entry = fullReport.vulnerabilities[name];
    const path = "node_modules/" + name;
    requireValue(
      entry.severity === "high" && same(entry.nodes, [path]),
      "Dependency severity or location changed",
    );
    requireValue(
      lock.packages[path]?.version === version &&
        lock.packages[path].dev === true,
      "Development dependency version or scope changed",
    );
    const copies = Object.keys(lock.packages).filter(
      (key) => key === path || key.endsWith("/" + path),
    );
    requireValue(same(copies, [path]), "Additional vulnerable dependency copy");
    requireValue(
      same(entry.effects, index === 0 ? [] : [chain[index - 1][0]]),
      "Dependency chain changed",
    );
    if (index < chain.length - 1) {
      const next = chain[index + 1][0];
      requireValue(
        same(entry.via, [next]) &&
          typeof lock.packages[path].dependencies?.[next] === "string",
        "Dependency chain changed",
      );
    } else {
      requireValue(
        entry.via.length === 1 &&
          object(entry.via[0]) &&
          entry.via[0].url === advisory &&
          entry.via[0].name === "braces" &&
          entry.via[0].dependency === "braces" &&
          entry.via[0].severity === "high" &&
          entry.via[0].range === "<=3.0.3",
        "Unexpected braces advisory",
      );
    }
  }
  return {
    accepted: true,
    exceptionUsed: true,
    advisory,
    expiresAt: expiry,
    developmentOnly: true,
  };
}

export function runAudit(cwd, production) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    command,
    [
      "audit",
      "--audit-level=high",
      "--json",
      ...(production ? ["--omit=dev"] : []),
    ],
    { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
  );
  requireValue(
    !result.error && !result.signal && [0, 1].includes(result.status),
    "npm audit execution failed",
  );
  const report = JSON.parse(result.stdout);
  validateReport(report, result.status);
  return { report, status: result.status };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const cwd = process.argv[2] ?? process.cwd();
    const full = runAudit(cwd, false);
    const production = runAudit(cwd, true);
    // Retain the complete findings in CI/release logs instead of suppressing them.
    console.log(
      JSON.stringify(
        { fullAudit: full.report, productionAudit: production.report },
        null,
        2,
      ),
    );
    const lock = JSON.parse(
      readFileSync(
        new URL("./package-lock.json", pathToFileURL(cwd + "/")),
        "utf8",
      ),
    );
    console.log(
      JSON.stringify(
        evaluate(full.report, production.report, lock, {
          fullStatus: full.status,
          productionStatus: production.status,
        }),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
