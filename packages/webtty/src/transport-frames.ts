// See LICENSE file in the project root for license information.

/** Incremental length-prefixed decoder: at most one bounded partial frame. */
export class WebTTYFrameDecoder {
  private readonly header = new Uint8Array(4);
  private headerBytes = 0;
  private payload: Uint8Array | null = null;
  private payloadBytes = 0;

  public constructor(private readonly maxMessageSize: number) {}

  public get incomplete(): boolean {
    return this.headerBytes !== 0 || this.payload !== null;
  }

  public reset(): void {
    this.headerBytes = 0;
    this.payload = null;
    this.payloadBytes = 0;
  }

  public *push(chunk: Uint8Array): Generator<Uint8Array, void> {
    const cursor = { offset: 0 };
    while (cursor.offset < chunk.byteLength) {
      if (this.payload === null) {
        const count = Math.min(
          4 - this.headerBytes,
          chunk.byteLength - cursor.offset,
        );
        this.header.set(
          chunk.subarray(cursor.offset, cursor.offset + count),
          this.headerBytes,
        );
        this.headerBytes += count;
        cursor.offset += count;
        if (this.headerBytes !== 4) return;
        const size = new DataView(this.header.buffer).getUint32(0, false);
        if (size > this.maxMessageSize)
          throw new Error(
            `WebTTY message exceeds the ${this.maxMessageSize} byte limit.`,
          );
        this.headerBytes = 0;
        if (chunk.byteLength - cursor.offset >= size) {
          const payload = chunk.subarray(cursor.offset, cursor.offset + size);
          cursor.offset += size;
          yield payload;
          continue;
        }
        this.payload = new Uint8Array(size);
        this.payloadBytes = 0;
      }
      const count = Math.min(
        this.payload.byteLength - this.payloadBytes,
        chunk.byteLength - cursor.offset,
      );
      this.payload.set(
        chunk.subarray(cursor.offset, cursor.offset + count),
        this.payloadBytes,
      );
      this.payloadBytes += count;
      cursor.offset += count;
      if (this.payloadBytes === this.payload.byteLength) {
        const payload = this.payload;
        this.payload = null;
        this.payloadBytes = 0;
        yield payload;
      }
    }
  }
}
