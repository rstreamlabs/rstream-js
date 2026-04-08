// See LICENSE file in the project root for license information.

/** @type {import('npm-check-updates').RunOptions} */
function keepCompatibleVersions(name, { upgradedSemver }) {
  const major = Number.parseInt(upgradedSemver?.major ?? "", 10);
  if (name === "eslint" || name === "@eslint/js") return major <= 9;
  if (name === "typescript") return major <= 5;
  return true;
}

module.exports = {
  filterResults: keepCompatibleVersions,
  target: "latest",
  workspaces: true,
};
