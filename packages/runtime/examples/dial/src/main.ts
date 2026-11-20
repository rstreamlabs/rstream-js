// See LICENSE file in the project root for license information.

import { Client } from "@rstreamlabs/runtime";
import { pipeline } from "node:stream/promises";

const name = process.argv[2] ?? "node-private-http";
const signal = AbortSignal.timeout(15_000);
const client = Client.fromEnv();
try {
  const stream = await client.dial(name, { signal });
  try {
    stream.write("GET / HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    await pipeline(stream, process.stdout, { end: false, signal });
  } finally {
    stream.destroy();
  }
} finally {
  await client.close();
}
