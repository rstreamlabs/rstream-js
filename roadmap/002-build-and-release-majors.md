# Upgrade JavaScript build and release tools together

The compiler, lint plugins, bundler and immutable release workflow need a coordinated major-version review. Qualify TypeScript 7, ESLint 10, Changesets 3 and npm 12 with their required Node versions before changing the declarations. Keep contributor tools separate from published SDK runtime support, as described in the [Node requirement plan](001-node-build-toolchain.md).
