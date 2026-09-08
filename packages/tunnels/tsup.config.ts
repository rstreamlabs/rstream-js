// See LICENSE file in the project root for license information.

import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  clean: true,
  entryPoints: ["src/index.ts", "src/openapi.ts"],
  format: ["cjs", "esm"],
  dts: options.watch
    ? true
    : { entry: { index: ".generated/types/index.d.ts", openapi: ".generated/types/openapi.d.ts" } },
}));
