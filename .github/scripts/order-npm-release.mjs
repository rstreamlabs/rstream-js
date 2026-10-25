import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function readManifest(entry) {
  assert.match(entry.directory, /^packages\/[a-z0-9][a-z0-9-]*$/);
  return JSON.parse(readFileSync(`${entry.directory}/package.json`, "utf8"));
}

function dependencyNames(manifest) {
  const groups = [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].filter((group) => group !== undefined);
  for (const group of groups) {
    assert.ok(
      group !== null && typeof group === "object" && !Array.isArray(group),
    );
    assert.ok(Object.values(group).every((value) => typeof value === "string"));
  }
  return [...new Set(groups.flatMap((group) => Object.keys(group)))].sort();
}

export function orderReleasePackages(entries, loadManifest = readManifest) {
  assert.ok(Array.isArray(entries) && entries.length <= 100);
  const pending = new Map();
  for (const entry of entries) {
    assert.ok(entry !== null && typeof entry === "object");
    assert.equal(typeof entry.name, "string");
    assert.equal(typeof entry.version, "string");
    assert.ok(
      !pending.has(entry.name),
      `Duplicate release package: ${entry.name}`,
    );
    pending.set(entry.name, entry);
  }
  const active = new Set();
  const completed = new Set();
  const ordered = [];
  function visit(entry) {
    if (completed.has(entry.name)) return;
    assert.ok(
      !active.has(entry.name),
      `Release dependency cycle: ${entry.name}`,
    );
    active.add(entry.name);
    const manifest = loadManifest(entry);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.version);
    for (const name of dependencyNames(manifest)) {
      const dependency = pending.get(name);
      if (dependency) visit(dependency);
    }
    active.delete(entry.name);
    completed.add(entry.name);
    ordered.push(entry);
  }
  for (const name of [...pending.keys()].sort()) visit(pending.get(name));
  return ordered;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assert.equal(process.argv.length, 3, "Expected a release manifest path");
  const release = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const ordered = orderReleasePackages(release.packages);
  for (const entry of ordered)
    process.stdout.write(`${JSON.stringify(entry)}\n`);
}
