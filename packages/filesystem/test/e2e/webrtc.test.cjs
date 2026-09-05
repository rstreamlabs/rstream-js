// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const { mkdtemp, writeFile, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createInterface } = require("node:readline");
const { test } = require("node:test");
const { RemoteFileSystem, WebRTCFileSystem, FileSystemError } = require("../../dist/index.js");
const { WebTTYFileSystem, WebTTYFileSystemError } = require("../../../webtty/dist/index.js");

const executable = process.env.RSTREAM_FILES_E2E_SERVER;
assert.ok(executable, "Set RSTREAM_FILES_E2E_SERVER to the Go filesystem/rtc/testdata/server executable; this integration suite never skips a missing dependency.");

async function fixture(t, mode, backend, relay = false, extra = []) {
  const root = await mkdtemp(join(tmpdir(), "rstream-files-rtc-"));
  const payload = Buffer.alloc(8 * 1024 * 1024 + 17);
  payload.forEach((_, index) => { payload[index] = index % 251; });
  await writeFile(join(root, "résumé #?% &.bin"), payload);
  const child = spawn(executable, ["--root", root, "--mode", mode, "--backend", backend, "--turn=" + relay, "--rtc-only=" + (backend === "webrtc"), ...extra], { stdio: ["ignore", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const errors = [];
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  const exit = once(child, "exit");
  t.after(async () => {
    child.kill("SIGTERM");
    const [code] = await exit;
    lines.close();
    await rm(root, { recursive: true, force: true });
    assert.equal(code, 0, errors.join(""));
  });
  const [line] = await Promise.race([once(lines, "line"), exit.then(() => { throw new Error(errors.join("") || "Fixture exited before ready"); })]);
  return { url: JSON.parse(line).url, root, payload };
}

for (const mode of ["files", "webtty"]) {
  for (const relay of [false, true]) {
    test(`${mode}: Node reads over ${relay ? "forced TURN" : "direct ICE"}, writes rejected`, { timeout: 45000 }, async (t) => {
      const source = await fixture(t, mode, "webrtc", relay);
      const client = mode === "webtty"
        ? new WebTTYFileSystem({ url: source.url, rtc: { iceTransportPolicy: relay ? "relay" : "all" } })
        : new WebRTCFileSystem({ url: source.url, rtc: { iceTransportPolicy: relay ? "relay" : "all" } });
      assert.equal((await fetch(source.url + "/fs/r%C3%A9sum%C3%A9%20%23%3F%25%20%26.bin")).status, 418, "fixture must prohibit hidden HTTP data fallback");
      const items = await client.readdir("/");
      assert.deepEqual(items, ["résumé #?% &.bin"]);
      const stat = await client.stat("/résumé #?% &.bin");
      assert.equal(stat.size, source.payload.length);
      const stream = await client.readStream("/résumé #?% &.bin", { range: "bytes=123-" });
      const reader = stream.getReader();
      const hash = createHash("sha256");
      const length = { value: 0 };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        hash.update(chunk.value);
        length.value += chunk.value.length;
      }
      reader.releaseLock();
      assert.equal(length.value, source.payload.length - 123);
      assert.equal(hash.digest("hex"), createHash("sha256").update(source.payload.subarray(123)).digest("hex"));
      for (const operation of [() => client.writeText("/new.txt", "denied"), () => client.mkdir("/new"), () => client.mkdir("/", { recursive: true }), () => client.rm("/résumé #?% &.bin"), () => client.rename("/résumé #?% &.bin", "/new.bin"), () => client.copyFile("/résumé #?% &.bin", "/copy.bin")]) {
        await assert.rejects(operation, (error) => error instanceof (mode === "webtty" ? WebTTYFileSystemError : FileSystemError) && error.status === 403 && error.message.includes("read-only"));
      }
      assert.deepEqual(await readFile(join(source.root, "résumé #?% &.bin")), source.payload);
      const canceled = await client.readStream("/résumé #?% &.bin");
      await canceled.cancel();
      const abort = new AbortController();
      const pending = client.readStream("/résumé #?% &.bin", { signal: abort.signal });
      abort.abort();
      await assert.rejects(pending);
    });
  }
}

test("WebDAV selection preserves existing WebTTY writes", { timeout: 15000 }, async (t) => {
  const source = await fixture(t, "webtty", "webdav");
  const client = new WebTTYFileSystem({ url: source.url });
  await client.writeText("/written.txt", "WebDAV still writes");
  assert.equal(await client.readText("/written.txt"), "WebDAV still writes");
  await client.rm("/written.txt");
  assert.equal(await client.exists("/written.txt"), false);
  const generic = new RemoteFileSystem({ url: source.url });
  assert.equal((await generic.stat("/résumé #?% &.bin")).kind, "file");
});


test("TURN download keeps its bytes across authenticated renewal and ICE restart", { timeout: 30000 }, async (t) => {
  const source = await fixture(t, "files", "webrtc", true, ["--lease=6s", "--restart=1s"]);
  const actions = [];
  const client = new WebRTCFileSystem({ url: source.url, rtc: { iceTransportPolicy: "relay" }, fetch: async (input, init) => {
    if (init?.method === "POST") actions.push(JSON.parse(init.body).action);
    return fetch(input, init);
  } });
  const stream = await client.readStream("/résumé #?% &.bin");
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    hash.update(chunk);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(hash.digest("hex"), createHash("sha256").update(source.payload).digest("hex"));
  assert.ok(actions.includes("restart"), actions.join(","));
  const archive = await client.archiveStream();
  const archiveReader = archive.getReader();
  const first = await archiveReader.read();
  await archiveReader.cancel();
  archiveReader.releaseLock();
  assert.equal(Buffer.from(first.value).subarray(0, 4).toString("hex"), "504b0304");
});

test("ESM filesystem client loads the Node WebRTC provider", { timeout: 20000 }, async (t) => {
  const source = await fixture(t, "files", "webrtc", true);
  const { RemoteFileSystem: ESMFileSystem } = await import("../../dist/index.mjs");
  const client = new ESMFileSystem({ url: source.url, rtc: { iceTransportPolicy: "relay" } });
  assert.equal((await client.stat("/résumé #?% &.bin")).size, source.payload.length);
});
