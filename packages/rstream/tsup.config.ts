// See LICENSE file in the project root for license information.

import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entryPoints: [
    "src/index.ts",
    "src/auth-token.ts",
    "src/tunnel.ts",
    "src/tunnels-project.ts",
    "src/turn.ts",
    "src/whoami.ts",
    "src/zod.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
});
