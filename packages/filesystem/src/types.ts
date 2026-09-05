// See LICENSE file in the project root for license information.

import type { FileSystemURLProvider } from "./backend";

export interface FileSystemConfig {
  archivePath?: string;
  authToken?: string;
  fetch?: typeof fetch;
  fsPath?: string;
  headers?: HeadersInit;
  url: FileSystemURLProvider;
}

export interface FileSystemItem {
  kind: "directory" | "file";
  modified?: string;
  path: string;
  size?: number;
}

export interface FileSystemRequestOptions {
  signal?: AbortSignal;
}

export interface FileSystemStreamOptions extends FileSystemRequestOptions {
  range?: string;
}

export interface FileSystemReadFileOptions extends FileSystemRequestOptions {
  encoding?: string | null;
}

export interface FileSystemMkdirOptions extends FileSystemRequestOptions {
  recursive?: boolean;
}

export interface FileSystemReaddirOptions extends FileSystemRequestOptions {
  withFileTypes?: boolean;
}

export interface FileSystemRmOptions extends FileSystemRequestOptions {
  force?: boolean;
  recursive?: boolean;
}

export interface FileSystemWriteFileOptions extends FileSystemRequestOptions {
  contentType?: string;
}

export interface FileSystemWriteStreamOptions extends FileSystemRequestOptions {
  contentType?: string;
}

export type FileSystemWriteData = BodyInit;

export class FileSystemError extends Error {
  public readonly operation: string;
  public readonly status: number;
  public constructor(operation: string, status: number, message: string) {
    super(`${operation} failed with status ${status}: ${message}`);
    this.name = "FileSystemError";
    this.operation = operation;
    this.status = status;
  }
}
