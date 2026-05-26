// See LICENSE file in the project root for license information.

import assert from "node:assert/strict";
import { openWebTTYCommand } from "../dist/index.mjs";
import { runWebTTYCommand } from "../dist/index.mjs";
import { WebTTYFileSystem } from "../dist/index.mjs";

const runtimeURL = process.env.WEBTTY_RUNTIME_E2E_URL ?? "ws://127.0.0.1:18080";
const timeoutMs = 15_000;

function client() {
  return { sendHeartbeat: false, url: runtimeURL };
}

function logKey(entry) {
  return `${entry.stream}:${entry.data}`;
}

async function collect(iterator, entries = []) {
  const result = await iterator.next();
  return result.done ? entries : collect(iterator, [...entries, result.value]);
}

async function readChunks(reader, chunks = []) {
  const result = await reader.read();
  return result.done
    ? Buffer.concat(chunks).toString()
    : readChunks(reader, [...chunks, Buffer.from(result.value)]);
}

async function readStreamText(stream) {
  const reader = stream.getReader();
  try {
    return await readChunks(reader);
  } finally {
    reader.releaseLock();
  }
}

async function testCollectedCommand() {
  const result = await runWebTTYCommand(
    client(),
    "sh",
    ["-lc", 'printf "%s" "$RSTREAM_E2E"; printf warn >&2'],
    { env: { RSTREAM_E2E: "runtime-ok" }, timeoutMs },
  );
  assert.deepEqual(result, {
    exitCode: 0,
    stderr: "warn",
    stdout: "runtime-ok",
    success: true,
  });
}

async function testFailedCommand() {
  const result = await runWebTTYCommand(
    client(),
    "sh",
    ["-lc", "printf failed; exit 7"],
    { timeoutMs },
  );
  assert.deepEqual(result, {
    exitCode: 7,
    stderr: "",
    stdout: "failed",
    success: false,
  });
}

async function testStreamingCommand() {
  const command = openWebTTYCommand(client(), {
    cmdArgs: [
      "sh",
      "-lc",
      "read line; printf stdout:$line; printf stderr:$line >&2",
    ],
    interactive: true,
    timeoutMs,
  });
  const logs = collect(command.logs());
  await command.writeStdin("payload\n");
  await command.closeStdin();
  assert.deepEqual(await command.wait(), { exitCode: 0, success: true });
  assert.equal(await command.stdout(), "stdout:payload");
  assert.equal(await command.stderr(), "stderr:payload");
  assert.equal(await readStreamText(command.stdoutStream()), "stdout:payload");
  assert.deepEqual((await logs).map(logKey).sort(), [
    "stderr:stderr:payload",
    "stdout:stdout:payload",
  ]);
}

async function testTimeoutAndKill() {
  const timeoutCommand = openWebTTYCommand(client(), {
    cmdArgs: ["sh", "-lc", "sleep 5"],
    timeoutMs: 10,
  });
  await assert.rejects(() => timeoutCommand.wait(), /timed out/);
  const killCommand = openWebTTYCommand(client(), {
    cmdArgs: ["sh", "-lc", "read line; sleep 30"],
    interactive: true,
    timeoutMs,
  });
  await killCommand.writeStdin("payload\n");
  await killCommand.kill();
  await assert.rejects(
    () => killCommand.wait(),
    /Session terminated by client/,
  );
}

async function testFilesystem() {
  const fs = new WebTTYFileSystem({ url: runtimeURL });
  await fs.rm("/sdk-e2e", { force: true, recursive: true });
  await fs.mkdir("/sdk-e2e", { recursive: true });
  await fs.writeFile("/sdk-e2e/hello.txt", "hello");
  await fs.writeStream("/sdk-e2e/stream.txt", new Blob(["stream"]).stream(), {
    contentType: "text/plain; charset=utf-8",
  });
  assert.equal(await fs.readFile("/sdk-e2e/hello.txt", "utf-8"), "hello");
  assert.equal(
    await readStreamText(await fs.readStream("/sdk-e2e/stream.txt")),
    "stream",
  );
  assert.equal(await fs.exists("/sdk-e2e/hello.txt"), true);
  assert.deepEqual((await fs.readdir("/sdk-e2e")).sort(), [
    "hello.txt",
    "stream.txt",
  ]);
  await fs.copyFile("/sdk-e2e/hello.txt", "/sdk-e2e/copy.txt");
  await fs.rename("/sdk-e2e/copy.txt", "/sdk-e2e/renamed.txt");
  assert.equal((await fs.stat("/sdk-e2e/renamed.txt")).kind, "file");
  await fs.rm("/sdk-e2e", { force: true, recursive: true });
  assert.equal(await fs.exists("/sdk-e2e"), false);
}

await testCollectedCommand();
await testFailedCommand();
await testStreamingCommand();
await testTimeoutAndKill();
await testFilesystem();
console.log("WebTTY runtime E2E passed.");
