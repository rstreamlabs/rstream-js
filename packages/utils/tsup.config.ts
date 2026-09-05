// See LICENSE file in the project root for license information.

import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entryPoints: ["src/index.ts", "src/file-sharing.ts", "src/download.ts"],
  format: ["cjs", "esm"],
  dts: true,
});
