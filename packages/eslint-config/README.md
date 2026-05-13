# `eslint-config`

Internal ESLint presets for the rstream JavaScript monorepo.

This package is private and is intended for packages in this repository. It
keeps TypeScript, React, Next.js, Prettier, and Turbo lint behavior consistent.

## Exports

| Import path | Use it for |
| --- | --- |
| `eslint-config/base` | TypeScript packages without React or Next.js. |
| `eslint-config/react-internal` | React library packages. |
| `eslint-config/next-js` | Next.js applications. |

## Usage

Base package:

```js
import { config } from "eslint-config/base";

export default config;
```

React package:

```js
import { config } from "eslint-config/react-internal";

export default config;
```

Next.js app:

```js
import { nextJsConfig } from "eslint-config/next-js";

export default nextJsConfig;
```

## Included Behavior

- ESLint recommended rules
- TypeScript ESLint recommended rules
- Prettier compatibility
- Turbo environment-variable warnings
- React and React Hooks rules for React/Next presets
- generated output ignores for `dist`, `.generated`, and `.next`
