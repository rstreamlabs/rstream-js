// See LICENSE file in the project root for license information.

import { Client } from "@rstreamlabs/runtime";
import { once } from "node:events";

const tunnel = process.argv[2];
if (!tunnel) {
  throw new Error("Usage: npm start -- <tunnel-id-or-name>");
}
const stream = await Client.fromEnv().dial(tunnel);
stream.write("ping\n");
const [chunk] = await once(stream, "data");
process.stdout.write(chunk);
stream.destroy();
