# Repository guidance

## Shared conventions

Follow the existing architecture, naming and coding style. Preserve public contracts, authentication, certificate verification and project policy. Keep changes in the component that owns the behavior.

Update user documentation and examples when behavior changes. Run the relevant checks; place regression tests with the owning component. Keep secrets, execution logs, investigation notes and standalone upstream reproductions outside the repository.

## Repository-specific guidance

Follow `CODING_STYLE.md` and `CONTRIBUTING.md`. Keep native Node runtime, Engine API, Control plane API and browser packages separate. Browser packages must not acquire Node-only dependencies or local credentials. Preserve package exports, workspace dependency ordering and runtime compatibility separately from contributor-tool requirements.
