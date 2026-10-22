// See LICENSE file in the project root for license information.

interface DownloadHandle {
  createWritable(): Promise<WritableStream<Uint8Array>>;
}

interface DownloadPicker {
  showSaveFilePicker(options: {
    suggestedName: string;
  }): Promise<DownloadHandle>;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (bytes: number) => void;
}

function hasDownloadPicker(value: unknown): value is DownloadPicker {
  return (
    typeof value === "object" &&
    value !== null &&
    "showSaveFilePicker" in value &&
    typeof value.showSaveFilePicker === "function"
  );
}

export function canSaveDownload(): boolean {
  return typeof window !== "undefined" && hasDownloadPicker(window);
}

export async function createDownloadDestination(
  filename: string,
): Promise<WritableStream<Uint8Array>> {
  if (typeof window === "undefined" || !hasDownloadPicker(window))
    throw new Error("File picker API is not available in this browser.");
  const handle = await window.showSaveFilePicker({ suggestedName: filename });
  return handle.createWritable();
}

export function createDownloadProgress(
  onProgress: (bytes: number) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const state = { bytes: 0 };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      state.bytes += chunk.byteLength;
      onProgress(state.bytes);
      controller.enqueue(chunk);
    },
  });
}

// Call directly from the click handler: choose the destination before awaiting
// network work so the browser's transient user activation is preserved.
export async function saveDownload(
  filename: string,
  source: () => Promise<ReadableStream<Uint8Array>>,
  options: DownloadOptions = {},
): Promise<void> {
  const destination = await createDownloadDestination(filename);
  try {
    options.signal?.throwIfAborted();
    const stream = await source();
    const progress = options.onProgress
      ? stream.pipeThrough(createDownloadProgress(options.onProgress), {
          signal: options.signal,
        })
      : stream;
    await progress.pipeTo(destination, { signal: options.signal });
  } catch (error) {
    await destination.abort(error).catch((failure: unknown) => {
      throw new AggregateError(
        [error, failure],
        "Download failed and the destination could not be closed.",
      );
    });
    throw error;
  }
}
