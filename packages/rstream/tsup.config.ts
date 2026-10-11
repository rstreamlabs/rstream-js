// See LICENSE file in the project root for license information.

import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  clean: true,
  entryPoints: [
    "src/auth-token.ts",
    "src/index.ts",
    "src/tunnel.ts",
    "src/tunnels-project-event.ts",
    "src/tunnels-project.ts",
    "src/tunnels-webhook.ts",
    "src/turn.ts",
    "src/whoami.ts",
    "src/zod.ts",
  ],
  format: ["cjs", "esm"],
  dts: options.watch
    ? true
    : {
        entry: {
          "auth-token": ".generated/types/auth-token.d.ts",
          index: ".generated/types/index.d.ts",
          tunnel: ".generated/types/tunnel.d.ts",
          "tunnels-project-event":
            ".generated/types/tunnels-project-event.d.ts",
          "tunnels-project": ".generated/types/tunnels-project.d.ts",
          "tunnels-webhook": ".generated/types/tunnels-webhook.d.ts",
          turn: ".generated/types/turn.d.ts",
          whoami: ".generated/types/whoami.d.ts",
          zod: ".generated/types/zod.d.ts",
        },
      },
}));
