// See LICENSE file in the project root for license information.

import { Sha256 } from "@aws-crypto/sha256-js";

export type FileSharingCryptoProvider = Pick<Crypto, "subtle">;

export type FileSharingChallengeOptions = {
  key: Uint8Array;
  now?: Date | number;
  crypto?: FileSharingCryptoProvider;
};

export type ImportFileSharingKeyOptions = {
  key: Uint8Array;
  crypto?: FileSharingCryptoProvider;
};

export type AesCtrDecryptStreamOptions = {
  key: CryptoKey;
  iv: Uint8Array;
  crypto?: FileSharingCryptoProvider;
};

export type FileSharingDownloadStreamOptions = {
  key: CryptoKey;
  crypto?: FileSharingCryptoProvider;
};

function resolveCrypto(
  webCrypto?: FileSharingCryptoProvider,
): FileSharingCryptoProvider {
  const resolved = webCrypto ?? globalThis.crypto;
  if (!resolved?.subtle) {
    throw new Error("Web Cryptography API is not available in this runtime.");
  }
  return resolved;
}

function getEpochHex(now?: Date | number): string {
  const timestamp =
    now instanceof Date ? now.getTime() : now === undefined ? Date.now() : now;
  if (!Number.isFinite(timestamp)) {
    throw new Error("File sharing challenge timestamp must be finite.");
  }
  return Math.trunc(timestamp).toString(16).padStart(16, "0");
}

function incrementCounter(counter: Uint8Array, blocks: number): void {
  const view = new DataView(
    counter.buffer,
    counter.byteOffset,
    counter.byteLength,
  );
  const previous = view.getBigUint64(8);
  const next = BigInt.asUintN(64, previous + BigInt(blocks));
  view.setBigUint64(8, next);
  if (next < previous) {
    view.setBigUint64(0, BigInt.asUintN(64, view.getBigUint64(0) + 1n));
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left);
  bytes.set(right, left.byteLength);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function formatHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => ("00" + b.toString(16)).slice(-2))
    .join("");
}

export function decodeFileSharingKey(value: string): Uint8Array {
  if (typeof globalThis.atob !== "function") {
    throw new Error("Base64 decoding is not available in this runtime.");
  }
  return Uint8Array.from(globalThis.atob(value), (c) => c.charCodeAt(0));
}

export async function sha256HexFromText(
  text: string,
  options?: { crypto?: FileSharingCryptoProvider },
): Promise<string> {
  const digest = await resolveCrypto(options?.crypto).subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return formatHex(new Uint8Array(digest));
}

export async function checksumFileSharingKeyHex(
  key: Uint8Array,
  options?: { crypto?: FileSharingCryptoProvider },
): Promise<string> {
  return sha256HexFromText(formatHex(key), options);
}

export async function createFileSharingAccessChallenge({
  key,
  now,
  crypto,
}: FileSharingChallengeOptions): Promise<string> {
  const epochHex = getEpochHex(now);
  const checksumHex = await checksumFileSharingKeyHex(key, { crypto });
  return (
    epochHex + (await sha256HexFromText(epochHex + checksumHex, { crypto }))
  );
}

export const createFileSharingDownloadChallenge =
  createFileSharingAccessChallenge;

export async function importFileSharingAesCtrKey({
  key,
  crypto,
}: ImportFileSharingKeyOptions): Promise<CryptoKey> {
  return resolveCrypto(crypto).subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "AES-CTR" },
    false,
    ["decrypt"],
  );
}

export abstract class AesCtrAlignedDecryptStream extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  constructor() {
    super({
      transform: async (chunk, controller) => {
        try {
          const buffer = this.leftover
            ? concatBytes(this.leftover, chunk)
            : chunk;
          const length = buffer.byteLength - (buffer.byteLength % 16);
          const aligned = buffer.slice(0, length);
          this.leftover =
            length === buffer.byteLength ? null : buffer.slice(length);
          if (aligned.byteLength > 0) {
            controller.enqueue(await this.process(aligned));
          }
        } catch (error) {
          controller.error(error);
        }
      },
      flush: async (controller) => {
        try {
          if (this.leftover) {
            controller.enqueue(await this.process(this.leftover));
            this.leftover = null;
          }
          controller.terminate();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  protected abstract process(buffer: Uint8Array): Promise<Uint8Array>;

  private leftover: Uint8Array | null = null;
}

export class AesCtrDecryptStream extends AesCtrAlignedDecryptStream {
  constructor({ key, iv, crypto }: AesCtrDecryptStreamOptions) {
    super();
    this.key = key;
    this.iv = iv.slice();
    this.crypto = resolveCrypto(crypto);
  }

  protected async process(buffer: Uint8Array): Promise<Uint8Array> {
    const decrypted = await this.crypto.subtle.decrypt(
      { name: "AES-CTR", counter: toArrayBuffer(this.iv), length: 128 },
      this.key,
      toArrayBuffer(buffer),
    );
    if (decrypted.byteLength !== buffer.byteLength) {
      throw new Error(
        "Decryption failed : " +
          decrypted.byteLength +
          " bytes decrypted out of " +
          buffer.byteLength +
          " bytes.",
      );
    }
    incrementCounter(this.iv, Math.ceil(decrypted.byteLength / 16));
    return new Uint8Array(decrypted);
  }

  private readonly key: CryptoKey;
  private readonly crypto: FileSharingCryptoProvider;
  private readonly iv: Uint8Array;
}

export class FileSharingDownloadStream extends TransformStream<
  Uint8Array,
  Uint8Array
> {
  constructor({ key, crypto }: FileSharingDownloadStreamOptions) {
    super({
      transform: async (chunk, controller) => {
        try {
          const buffer = this.leftover
            ? concatBytes(this.leftover, chunk)
            : chunk;
          const hasIv = this.iv !== null;
          if (!hasIv && buffer.byteLength < 16) {
            this.leftover = buffer;
            return;
          }
          const iv = this.iv ?? buffer.slice(0, 16);
          this.iv = iv;
          this.leftover = null;
          const payload = hasIv ? buffer : buffer.slice(16);
          if (!this.lower) {
            this.lower = new AesCtrDecryptStream({
              crypto: this.crypto,
              iv,
              key,
            });
            this.promise = this.loop(controller);
          }
          if (payload.byteLength > 0) {
            const writer = this.lower.writable.getWriter();
            try {
              await writer.write(payload);
            } finally {
              writer.releaseLock();
            }
          }
        } catch (error) {
          controller.error(error);
        }
      },
      flush: async (controller) => {
        try {
          if (this.leftover || !this.iv || !this.lower || !this.promise) {
            throw new Error("Partial read, file may be corrupted.");
          }
          const writer = this.lower.writable.getWriter();
          try {
            await writer.close();
          } finally {
            writer.releaseLock();
          }
          await this.promise;
          this.promise = null;
          if (!this.checksum || this.checksumLength !== 32) {
            throw new Error("Checksum not found, file may be corrupted.");
          }
          const checksumHex = formatHex(this.checksum);
          const digestHex = formatHex(await this.sha256.digest());
          if (checksumHex !== digestHex) {
            throw new Error("Checksum mismatch, file may be corrupted.");
          }
          controller.terminate();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    this.crypto = resolveCrypto(crypto);
  }

  private async *read(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async loop(
    controller: TransformStreamDefaultController<Uint8Array>,
  ): Promise<void> {
    if (!this.lower) return;
    for await (const decrypted of this.read(this.lower.readable.getReader())) {
      const payload = this.consumeDecrypted(decrypted);
      if (payload.byteLength > 0) {
        this.sha256.update(payload);
        controller.enqueue(payload);
      }
    }
  }

  private consumeDecrypted(decrypted: Uint8Array): Uint8Array {
    if (!this.checksum) {
      this.checksum = new Uint8Array(32);
    }
    if (this.checksumLength >= 32) {
      return decrypted;
    }
    const length = Math.min(decrypted.byteLength, 32 - this.checksumLength);
    this.checksum.set(decrypted.slice(0, length), this.checksumLength);
    this.checksumLength += length;
    return decrypted.slice(length);
  }

  private readonly crypto: FileSharingCryptoProvider;
  private readonly sha256 = new Sha256();
  private leftover: Uint8Array | null = null;
  private iv: Uint8Array | null = null;
  private lower: TransformStream<Uint8Array, Uint8Array> | null = null;
  private promise: Promise<void> | null = null;
  private checksum: Uint8Array | null = null;
  private checksumLength = 0;
}
