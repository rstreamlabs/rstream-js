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

function incrementCounter(counter: Uint8Array): void {
  for (let i = counter.byteLength - 1; i >= 0; i--) {
    const current = counter[i];
    if (current === undefined) continue;
    if (current === 255) {
      counter[i] = 0;
    } else {
      counter[i] = current + 1;
      break;
    }
  }
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
          let buffer = chunk;
          if (this.leftover) {
            buffer = new Uint8Array(
              this.leftover.byteLength + chunk.byteLength,
            );
            buffer.set(this.leftover);
            buffer.set(chunk, this.leftover.byteLength);
            this.leftover = null;
          }
          const length = buffer.byteLength - (buffer.byteLength % 16);
          if (length !== buffer.byteLength) {
            this.leftover = buffer.slice(length);
            buffer = buffer.slice(0, length);
          }
          if (buffer.byteLength > 0) {
            controller.enqueue(await this.process(buffer));
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
    for (let i = 0; i < Math.floor(decrypted.byteLength / 16); i++) {
      incrementCounter(this.iv);
    }
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
          let buffer = chunk;
          if (this.leftover) {
            buffer = new Uint8Array(
              this.leftover.byteLength + chunk.byteLength,
            );
            buffer.set(this.leftover);
            buffer.set(chunk, this.leftover.byteLength);
            this.leftover = null;
          }
          if (!this.iv) {
            if (buffer.byteLength < 16) {
              this.leftover = buffer;
              return;
            }
            this.iv = buffer.slice(0, 16);
            buffer = buffer.slice(16);
          }
          if (!this.lower) {
            this.lower = new AesCtrDecryptStream({
              crypto: this.crypto,
              iv: this.iv,
              key,
            });
            this.promise = this.loop(controller);
          }
          if (buffer.byteLength > 0) {
            const writer = this.lower.writable.getWriter();
            await writer.write(buffer);
            writer.releaseLock();
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
          await this.lower.writable.getWriter().close();
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
    try {
      if (!this.lower) return;
      for await (let decrypted of this.read(this.lower.readable.getReader())) {
        if (!this.checksum) {
          this.checksum = new Uint8Array(32);
        }
        if (this.checksumLength < 32) {
          const length = Math.min(
            decrypted.byteLength,
            32 - this.checksumLength,
          );
          this.checksum.set(decrypted.slice(0, length), this.checksumLength);
          this.checksumLength += length;
          decrypted = decrypted.slice(length);
        }
        if (decrypted.byteLength > 0) {
          this.sha256.update(decrypted);
          controller.enqueue(decrypted);
        }
      }
    } catch (error) {
      controller.error(error);
    }
  }

  private readonly crypto: FileSharingCryptoProvider;
  private leftover: Uint8Array | null = null;
  private iv: Uint8Array | null = null;
  private lower: TransformStream<Uint8Array, Uint8Array> | null = null;
  private promise: Promise<void> | null = null;
  private checksum: Uint8Array | null = null;
  private checksumLength = 0;
  private sha256 = new Sha256();
}
