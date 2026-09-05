// See LICENSE file in the project root for license information.

import { RemoteFileSystem } from "@rstreamlabs/filesystem";
import { FileSystemError } from "@rstreamlabs/filesystem";
import { resolveFileSystemURL } from "@rstreamlabs/filesystem";
import type { RemoteFileSystemConfig } from "@rstreamlabs/filesystem";
import type { FileSystemItem } from "@rstreamlabs/filesystem";
import type { FileSystemRequestOptions } from "@rstreamlabs/filesystem";
import type { FileSystemReadFileOptions } from "@rstreamlabs/filesystem";
import type { FileSystemMkdirOptions } from "@rstreamlabs/filesystem";
import type { FileSystemReaddirOptions } from "@rstreamlabs/filesystem";
import type { FileSystemRmOptions } from "@rstreamlabs/filesystem";
import type { FileSystemWriteFileOptions } from "@rstreamlabs/filesystem";
import type { FileSystemWriteStreamOptions } from "@rstreamlabs/filesystem";
import type { FileSystemWriteData } from "@rstreamlabs/filesystem";

export { parseWebDAVMultiStatus } from "@rstreamlabs/filesystem";
export const resolveWebTTYFileSystemURL = resolveFileSystemURL;
export type WebTTYFileSystemConfig = RemoteFileSystemConfig;
export type WebTTYFileSystemItem = FileSystemItem;
export type WebTTYFileSystemRequestOptions = FileSystemRequestOptions;
export type WebTTYFileSystemReadFileOptions = FileSystemReadFileOptions;
export type WebTTYFileSystemMkdirOptions = FileSystemMkdirOptions;
export type WebTTYFileSystemReaddirOptions = FileSystemReaddirOptions;
export type WebTTYFileSystemRmOptions = FileSystemRmOptions;
export type WebTTYFileSystemWriteFileOptions = FileSystemWriteFileOptions;
export type WebTTYFileSystemWriteStreamOptions = FileSystemWriteStreamOptions;
export type WebTTYFileSystemWriteData = FileSystemWriteData;

export class WebTTYFileSystemError extends FileSystemError {
  public constructor(operation: string, status: number, message: string) {
    super(operation, status, message);
    this.name = "WebTTYFileSystemError";
  }
}

export class WebTTYFileSystem extends RemoteFileSystem {
  protected override createError(
    operation: string,
    status: number,
    message: string,
  ): WebTTYFileSystemError {
    return new WebTTYFileSystemError(operation, status, message);
  }
}
