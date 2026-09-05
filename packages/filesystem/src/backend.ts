// See LICENSE file in the project root for license information.

import type { FileSystemItem } from "./types";
import type { FileSystemRequestOptions } from "./types";
import type { FileSystemStreamOptions } from "./types";

export type FileSystemURLProvider =
  string | URL | (() => Promise<string | URL> | string | URL);

export interface FileSystemBackend {
  list(
    path?: string,
    options?: FileSystemRequestOptions,
  ): Promise<FileSystemItem[]>;
  stat(
    path: string,
    options?: FileSystemRequestOptions,
  ): Promise<FileSystemItem>;
  readStream(
    path: string,
    options?: FileSystemStreamOptions,
  ): Promise<ReadableStream<Uint8Array>>;
  downloadURL(path: string): Promise<URL>;
  archiveStream(
    path?: string,
    options?: FileSystemRequestOptions,
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface FileSystemCapabilities {
  list: boolean;
  read: boolean;
  write: boolean;
  resume: boolean;
  archive: boolean;
  e2ee: boolean;
}
