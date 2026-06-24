// See LICENSE file in the project root for license information.

import { createWebTTYE2EClientPayloadCrypto } from "../dist/index.mjs";
import { createWebTTYE2EClientPayloadCryptoFromLocalTrust } from "../dist/node.mjs";
import { openWebTTYCommand } from "../dist/index.mjs";
import { runWebTTYCommand } from "../dist/index.mjs";
import { WebTTYFileSystem } from "../dist/index.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const runtimeURL = process.env.WEBTTY_RUNTIME_E2E_URL ?? "ws://127.0.0.1:18080";
const runtimeTransport = process.env.WEBTTY_RUNTIME_E2E_TRANSPORT ?? "";
const runtimeRecipient = process.env.WEBTTY_RUNTIME_E2E_RECIPIENT ?? "";
const runtimeServerIdentity =
  process.env.WEBTTY_RUNTIME_E2E_SERVER_IDENTITY ?? runtimeRecipient;
const runtimeClientIdentityFile =
  process.env.WEBTTY_RUNTIME_E2E_CLIENT_IDENTITY_FILE ?? "";
const runtimeKeyContext = process.env.WEBTTY_RUNTIME_E2E_KEY_CONTEXT ?? "";
const runtimeLocalTrust = process.env.WEBTTY_RUNTIME_E2E_LOCAL_TRUST === "1";
const timeoutMs = 15_000;
const endpointIdentity = await createRuntimeEndpointIdentity();
const expectedServerIdentity = parseRuntimeServerIdentity(runtimeServerIdentity);
const payloadCrypto = await createRuntimePayloadCrypto();

function client() {
  return {
    clientPrincipalId: endpointIdentity ? "runtime-js" : undefined,
    endpointIdentity,
    expectedServerIdentity,
    sendHeartbeat: false,
    transport: runtimeTransport || undefined,
    url: runtimeURL,
  };
}

function executionOptions(options = {}) {
  return {
    ...options,
    payloadCrypto: payloadCrypto ?? options.payloadCrypto,
  };
}

async function createRuntimePayloadCrypto() {
  if (runtimeLocalTrust) {
    return await createWebTTYE2EClientPayloadCryptoFromLocalTrust({
      keyContext: runtimeKeyContext,
      required: true,
    });
  }
  if (!runtimeRecipient) return undefined;
  const parts = runtimeRecipient.split(":");
  assert.ok(
    parts.length === 2 || parts.length === 4,
    "WEBTTY_RUNTIME_E2E_RECIPIENT must be key_id:public_key or endpoint identity",
  );
  return await createWebTTYE2EClientPayloadCrypto({
    keyContext: runtimeKeyContext,
    recipients: [{ keyId: parts[0], publicKey: parts[1] }],
  });
}

async function createRuntimeEndpointIdentity() {
  if (!runtimeClientIdentityFile) return undefined;
  const raw = await fs.readFile(runtimeClientIdentityFile, "utf8");
  const doc = JSON.parse(raw);
  assert.equal(
    doc.crypto_suite,
    "webtty-endpoint-x25519-ecdsa-p256-v1",
    "unexpected WebTTY endpoint identity suite",
  );
  return {
    signing: {
      keyId: base64URLDecode(doc.signing_key_id),
      privateKey: base64URLDecode(doc.signing_private_key),
      publicKey: base64URLDecode(doc.signing_public_key),
    },
  };
}

function parseRuntimeServerIdentity(value) {
  if (!value) return undefined;
  const parts = value.split(":");
  if (parts.length !== 4) return undefined;
  return {
    encryptionKeyId: base64URLDecode(parts[0]),
    encryptionPublicKey: base64URLDecode(parts[1]),
    signingKeyId: base64URLDecode(parts[2]),
    signingPublicKey: base64URLDecode(parts[3]),
  };
}

function base64URLDecode(value) {
  return new Uint8Array(Buffer.from(value, "base64url"));
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
    executionOptions({ env: { RSTREAM_E2E: "runtime-ok" }, timeoutMs }),
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
    executionOptions({ timeoutMs }),
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
    ...executionOptions(),
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
    ...executionOptions(),
    cmdArgs: ["sh", "-lc", "sleep 5"],
    timeoutMs: 10,
  });
  await assert.rejects(() => timeoutCommand.wait(), /timed out/);
  const killCommand = openWebTTYCommand(client(), {
    ...executionOptions(),
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
if (!runtimeTransport && !payloadCrypto) {
  await testFilesystem();
}
console.log("WebTTY runtime E2E passed.");
