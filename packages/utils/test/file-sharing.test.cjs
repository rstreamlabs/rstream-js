// See LICENSE file in the project root for license information.

const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const test = require("node:test");

const {
  AesCtrDecryptStream,
  createFileSharingAccessChallenge,
  FileSharingDownloadStream,
  formatHex,
  importFileSharingAesCtrKey,
  sha256HexFromText,
} = require("../dist/file-sharing.js");

const encoder = new TextEncoder();

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function chunkBytes(bytes, sizes) {
  const chunks = [];
  let offset = 0;
  for (const size of sizes) {
    chunks.push(bytes.slice(offset, Math.min(offset + size, bytes.byteLength)));
    offset += size;
  }
  if (offset < bytes.byteLength) chunks.push(bytes.slice(offset));
  return chunks.filter((chunk) => chunk.byteLength > 0);
}

function copyBuffer(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function aesKey() {
  return await webcrypto.subtle.generateKey(
    { length: 128, name: "AES-CTR" },
    true,
    ["encrypt", "decrypt"],
  );
}

async function aesCtrEncrypt(key, iv, payload) {
  return new Uint8Array(
    await webcrypto.subtle.encrypt(
      { counter: copyBuffer(iv), length: 128, name: "AES-CTR" },
      key,
      copyBuffer(payload),
    ),
  );
}

async function readAll(readable) {
  const reader = readable.getReader();
  const chunks = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return concatBytes(chunks);
    chunks.push(next.value);
  }
}

async function writeChunks(stream, chunks) {
  const read = readAll(stream.readable);
  const writer = stream.writable.getWriter();
  const write = async () => {
    for (const chunk of chunks) {
      await writer.write(chunk);
    }
    await writer.close();
  };
  const [result] = await Promise.all([read, write()]);
  return result;
}

async function encryptedDownload(key, iv, payload) {
  const checksum = new Uint8Array(
    await webcrypto.subtle.digest("SHA-256", copyBuffer(payload)),
  );
  const encrypted = await aesCtrEncrypt(
    key,
    iv,
    concatBytes([checksum, payload]),
  );
  return concatBytes([iv, encrypted]);
}

test("formatHex left-pads bytes as lowercase hex", () => {
  assert.equal(formatHex(new Uint8Array([0, 1, 15, 16, 255])), "00010f10ff");
});

test("file sharing access challenge is derived from key checksum and epoch", async () => {
  const key = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const epoch = "0000018bcfe56800";
  const keyChecksum = await sha256HexFromText(formatHex(key), {
    crypto: webcrypto,
  });
  const expected =
    epoch +
    (await sha256HexFromText(epoch + keyChecksum, { crypto: webcrypto }));
  assert.equal(
    await createFileSharingAccessChallenge({
      crypto: webcrypto,
      key,
      now: Number.parseInt(epoch, 16),
    }),
    expected,
  );
});

test("file sharing AES key import accepts raw bytes", async () => {
  const key = await importFileSharingAesCtrKey({
    crypto: webcrypto,
    key: webcrypto.getRandomValues(new Uint8Array(32)),
  });
  assert.equal(key.type, "secret");
});

test("AES-CTR decrypt stream preserves plaintext across awkward chunk boundaries", async () => {
  const key = await aesKey();
  const iv = new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 254,
  ]);
  const payload = encoder.encode(
    "chunked AES-CTR payload spanning several blocks and counter increments",
  );
  const encrypted = await aesCtrEncrypt(key, iv, payload);
  const decrypted = await writeChunks(
    new AesCtrDecryptStream({ crypto: webcrypto, iv: iv.slice(), key }),
    chunkBytes(encrypted, [1, 2, 13, 5, 7, 29]),
  );
  assert.deepEqual(decrypted, payload);
});

test("file sharing download stream validates checksum while plaintext checksum bytes are split", async () => {
  const key = await aesKey();
  const iv = webcrypto.getRandomValues(new Uint8Array(16));
  const payload = encoder.encode("secure file payload with a split checksum");
  const encrypted = await encryptedDownload(key, iv, payload);
  const decrypted = await writeChunks(
    new FileSharingDownloadStream({ crypto: webcrypto, key }),
    chunkBytes(encrypted, [3, 7, 11, 5, 1, 2, 13, 17]),
  );
  assert.deepEqual(decrypted, payload);
});

test("file sharing download stream rejects corrupted ciphertext and partial files", async () => {
  const key = await aesKey();
  const iv = webcrypto.getRandomValues(new Uint8Array(16));
  const payload = encoder.encode("payload that must fail checksum validation");
  const encrypted = await encryptedDownload(key, iv, payload);
  encrypted[encrypted.byteLength - 1] ^= 1;
  await assert.rejects(
    () =>
      writeChunks(
        new FileSharingDownloadStream({ crypto: webcrypto, key }),
        chunkBytes(encrypted, [8, 9, 10, 11]),
      ),
    { message: "Checksum mismatch, file may be corrupted." },
  );
  await assert.rejects(
    () =>
      writeChunks(new FileSharingDownloadStream({ crypto: webcrypto, key }), [
        new Uint8Array([1, 2, 3]),
      ]),
    { message: "Partial read, file may be corrupted." },
  );
});
