// See LICENSE file in the project root for license information.

import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  external: ["@roamhq/wrtc"],
  entryPoints: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
});
