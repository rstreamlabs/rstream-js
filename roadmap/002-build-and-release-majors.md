# Upgrade JavaScript build and release tools together

The compiler, lint plugins and immutable release workflow need a coordinated major-version review. Qualify TypeScript 7, ESLint 10 and npm 12 with their required Node versions before changing the declarations; retain the existing Changesets 3 candidate and promotion checks.

Align the contributor baseline with the installed tools without changing published SDK runtime claims. The [Node requirement plan](001-node-build-toolchain.md) tracks that distinction.
