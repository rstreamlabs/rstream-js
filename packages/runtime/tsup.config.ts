// See LICENSE file in the project root for license information.

import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entryPoints: ["src/index.ts"],
  format: ["cjs", "esm"],
  noExternal: [/^protobufjs(\/.*)?$/],
  dts: {
    resolve: ["@rstreamlabs/tunnels"],
  },
});
