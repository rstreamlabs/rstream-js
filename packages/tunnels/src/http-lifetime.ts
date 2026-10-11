// See LICENSE file in the project root for license information.

export const requestLifetime = (
  parents: Array<AbortSignal | undefined | null>,
  milliseconds: number,
): { signal: AbortSignal; close(): void; stopTimer(): void; abort(): void } => {
  const controller = new AbortController();
  const signals = parents.filter((signal) => signal != null);
  const listeners = signals.map((signal) => ({
    signal,
    abort: () => controller.abort(signal.reason),
  }));
  for (const listener of listeners) {
    if (listener.signal.aborted) listener.abort();
    else
      listener.signal.addEventListener("abort", listener.abort, { once: true });
  }
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Engine request timed out.", "TimeoutError"),
      ),
    milliseconds,
  );
  return {
    signal: controller.signal,
    stopTimer: () => clearTimeout(timer),
    abort: () =>
      controller.abort(
        new DOMException("Engine request closed.", "AbortError"),
      ),
    close: () => {
      clearTimeout(timer);
      for (const listener of listeners)
        listener.signal.removeEventListener("abort", listener.abort);
    },
  };
};

const readChunks = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
  chunks: Uint8Array[],
  size: number,
): Promise<Uint8Array[]> => {
  const result = await reader.read();
  if (result.done) return chunks;
  const total = size + result.value.byteLength;
  if (total > limit) {
    await reader.cancel();
    throw new Error("HTTP response exceeds the size limit.");
  }
  chunks.push(result.value);
  return readChunks(reader, limit, chunks, total);
};

export const readBoundedText = async (
  response: Response,
  limit: number,
): Promise<string> => {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("HTTP response exceeds the size limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = await readChunks(reader, limit, [], 0).finally(() =>
    reader.releaseLock(),
  );
  const bytes = new Uint8Array(
    chunks.reduce((size, chunk) => size + chunk.byteLength, 0),
  );
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return new TextDecoder().decode(bytes);
};

export const waitWithSignal = async <T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) {
    void promise.catch(() => undefined);
    signal.throwIfAborted();
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
};
