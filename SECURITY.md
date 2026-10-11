# Security Policy

If you believe you have found a security issue in `rstream-js`, please avoid opening a public issue with exploit details.

Use GitHub private vulnerability reporting for this repository when it is available. If that path is not enabled yet, contact the maintainers privately at `reports@rstream.io` before disclosing the issue in public.

When reporting an issue, include:

- the affected package or SDK surface
- the version or commit you tested
- the impact you observed
- enough reproduction detail for the issue to be validated

Security reports are treated as a priority and handled through a coordinated fix and disclosure process.

## Temporary development dependency exception

CI and immutable release preparation run `npm run audit:dependencies`. This runs
the complete npm audit and a separate production audit, and preserves both
reports in the logs. High and critical production findings always fail.

The maintainer approved one exception on 2026-10-11 for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
a stack-exhaustion denial of service in `braces`. No patched version was
available when the exception was approved. Its only accepted path is the
development linter chain `@next/eslint-plugin-next@16.4.0` → `fast-glob@3.3.1` →
`micromatch@4.0.8` → `braces@3.0.3`. These packages are excluded from production
dependencies; linting evaluates repository-owned patterns in the CI build.

The exception expires at **2026-11-09 00:00 UTC**. The checker rejects another
advisory, a critical finding, a changed version or dependency path, an additional
copy, production exposure, audit execution errors, and use after expiration.
Lower-severity findings retain the existing npm audit threshold. Update the
maintained linter dependency when an upstream fix becomes available and remove
the exception; a clean audit passes without using it.
