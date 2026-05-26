// See LICENSE file in the project root for license information.

import dotenv from "dotenv";
import { WebTTYRemoteExecutor } from "@rstreamlabs/webtty";

dotenv.config({ path: ".env.local" });

function env(name: string): string {
  const value = process.env[name];
  if (value) return value;
  throw new Error(`Missing required environment variable: ${name}`);
}

async function main(): Promise<void> {
  const executor = new WebTTYRemoteExecutor({
    url: env("RSTREAM_WEBTTY_URL"),
  });
  const result = await executor.runCommand("sh", ["-lc", "uname -a && pwd"], {
    timeoutMs: 30_000,
  });
  console.log({ exitCode: result.exitCode, stdout: result.stdout });
  const command = await executor.openCommand("sh", [
    "-lc",
    "for i in 1 2 3; do echo tick:$i; sleep 1; done",
  ]);
  for await (const entry of command.logs()) {
    process[entry.stream === "stdout" ? "stdout" : "stderr"].write(entry.data);
  }
  const status = await command.wait();
  if (!status.success)
    throw new Error(`Remote command exited with ${status.exitCode}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
