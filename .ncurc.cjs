/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  target: (name) => (name === 'zod' ? 'minor' : 'latest'),
  workspaces: true,
};
