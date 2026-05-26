// See LICENSE file in the project root for license information.

import dotenv from "dotenv";
import { WebTTYFileSystem } from "@rstreamlabs/webtty";

dotenv.config({ path: ".env.local" });

function env(name: string): string {
  const value = process.env[name];
  if (value) return value;
  throw new Error(`Missing required environment variable: ${name}`);
}

async function readText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks = await readChunks(reader);
  reader.releaseLock();
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunks: readonly Uint8Array[] = [],
): Promise<readonly Uint8Array[]> {
  const result = await reader.read();
  return result.done ? chunks : readChunks(reader, [...chunks, result.value]);
}

async function main(): Promise<void> {
  const fs = new WebTTYFileSystem({
    url: env("RSTREAM_WEBTTY_URL"),
  });
  await fs.writeFile("/codex-note.txt", "written through rstream WebTTY\n");
  console.log(await fs.readdir("/"));
  console.log(await fs.readText("/codex-note.txt"));
  console.log(await readText(await fs.readStream("/codex-note.txt")));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
