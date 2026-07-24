// See LICENSE file in the project root for license information.

/** @type {import('npm-check-updates').RunOptions} */
function keepSupportedToolchain(name, { upgradedSemver }) {
  const major = Number.parseInt(upgradedSemver?.major ?? "", 10);
  if (name === "eslint" || name === "@eslint/js") return major <= 9;
  if (name === "typescript") return major <= 6;
  return true;
}

module.exports = {
  // React's ESLint plugins support ESLint 9; typescript-eslint supports TypeScript <6.1.
  filterResults: keepSupportedToolchain,
  target: "latest",
  workspaces: true,
};
