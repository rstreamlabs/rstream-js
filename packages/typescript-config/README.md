# `typescript-config`

Internal TypeScript presets for the rstream JavaScript monorepo.

This package is private and is intended for packages in this repository. It
keeps compiler targets, module resolution, strictness, and JSX behavior
consistent across SDK packages and apps.

## Presets

| File | Use it for |
| --- | --- |
| `base.json` | Shared strict TypeScript settings for libraries and tools. |
| `react-library.json` | React library packages using the automatic JSX runtime. |
| `nextjs.json` | Next.js applications. |

## Usage

Library package:

```json
{
  "extends": "typescript-config/base.json"
}
```

React library:

```json
{
  "extends": "typescript-config/react-library.json"
}
```

Next.js app:

```json
{
  "extends": "typescript-config/nextjs.json"
}
```

## Shared Defaults

- ES2022 target and library baseline
- bundler module resolution
- strict type checking
- declaration output for libraries
- `noUncheckedIndexedAccess`
- JSON module support
- skipped library checks for faster monorepo builds
