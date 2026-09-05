// See LICENSE file in the project root for license information.

import type { FileSystemBackend } from "./backend";
import type { FileSystemURLProvider } from "./backend";

import type { FileSystemConfig } from "./types";
import type { FileSystemItem } from "./types";
import type { FileSystemRequestOptions } from "./types";
import type { FileSystemStreamOptions } from "./types";
import type { FileSystemReadFileOptions } from "./types";
import type { FileSystemMkdirOptions } from "./types";
import type { FileSystemReaddirOptions } from "./types";
import type { FileSystemRmOptions } from "./types";
import type { FileSystemWriteFileOptions } from "./types";
import type { FileSystemWriteStreamOptions } from "./types";
import type { FileSystemWriteData } from "./types";
import { FileSystemError } from "./types";
export * from "./types";

interface FileSystemFetchInit extends RequestInit {
  duplex?: "half";
}

interface FileSystemRequest {
  body?: BodyInit;
  expectedStatuses: readonly number[];
  headers?: HeadersInit;
  operation: string;
  signal?: AbortSignal;
}

const webDAVPropfindBody =
  '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>';

function cleanTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeRemotePath(remotePath: string): string {
  const absolute = remotePath === "" || remotePath === "." ? "/" : remotePath;
  const parts = absolute.split("/");
  if (
    parts.includes("..") ||
    absolute.includes("\\") ||
    absolute.includes("\0")
  ) {
    throw new Error("Filesystem paths must stay within the shared root.");
  }
  const encoded = parts.map((part) => encodeURIComponent(part)).join("/");
  return encoded.startsWith("/") ? encoded : `/${encoded}`;
}

function comparableRemotePath(remotePath: string): string {
  const normalized = cleanTrailingSlashes(normalizeRemotePath(remotePath));
  return normalized === "" ? "/" : normalized;
}

function sidecarPath(fsPath: string | undefined): string {
  return normalizeRemotePath(fsPath ?? "/fs");
}

function filesystemBasePath(
  pathname: string,
  fsPath: string | undefined,
): string {
  const sidecar = sidecarPath(fsPath);
  const basePath = cleanTrailingSlashes(pathname);
  if (basePath === "") return sidecar;
  if (basePath === "/") return sidecar;
  if (basePath === sidecar || basePath.startsWith(`${sidecar}/`))
    return basePath;
  return `${basePath}${sidecar}`;
}

function filesystemPath(
  pathname: string,
  remotePath: string,
  fsPath: string | undefined,
): string {
  const basePath = filesystemBasePath(pathname, fsPath);
  const normalized = normalizeRemotePath(remotePath);
  return normalized === "/"
    ? basePath
    : `${cleanTrailingSlashes(basePath)}${normalized}`;
}

export function resolveFileSystemURL(
  input: string | URL,
  remotePath = "/",
  fsPath?: string,
): URL {
  const url = new URL(input.toString());
  if (url.protocol === "rstrm:") {
    throw new Error(
      "rstrm:// Filesystem URLs require the native rstream dialer.",
    );
  }
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported Filesystem URL scheme "${url.protocol}".`);
  }
  url.pathname = filesystemPath(url.pathname, remotePath, fsPath);
  url.hash = "";
  return url;
}

function responseAllowed(
  response: Response,
  expectedStatuses: readonly number[],
): boolean {
  return expectedStatuses.includes(response.status);
}

async function responseErrorMessage(response: Response): Promise<string> {
  if (!response.body) return response.statusText;
  const reader = response.body.getReader();
  const bytes = new Uint8Array(4096);
  const length = { value: 0 };
  try {
    while (length.value < bytes.length) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const part = chunk.value.subarray(0, bytes.length - length.value);
      bytes.set(part, length.value);
      length.value += part.length;
    }
    const text = new TextDecoder()
      .decode(bytes.subarray(0, length.value))
      .trim();
    return text === "" ? response.statusText : text;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function requireResponseBody(
  response: Response,
  operation: string,
): ReadableStream<Uint8Array> {
  if (response.body) return response.body;
  throw new Error(
    `${operation} failed because the response body is unavailable.`,
  );
}

function resolveFetch(config: FileSystemConfig): typeof fetch {
  if (config.fetch) return config.fetch;
  if (typeof fetch === "undefined") {
    throw new Error("fetch is unavailable in this runtime.");
  }
  return fetch;
}

function applyHeaders(
  target: Headers,
  source: HeadersInit | undefined,
): Headers {
  const sourceHeaders = new Headers(source);
  sourceHeaders.forEach((value, key) => target.set(key, value));
  return target;
}

function requestHeaders(
  config: FileSystemConfig,
  headers: HeadersInit | undefined,
): Headers {
  const result = applyHeaders(new Headers(config.headers), headers);
  if (config.authToken && config.authToken.trim() !== "") {
    result.set("Authorization", `Bearer ${config.authToken.trim()}`);
  }
  return result;
}

function contentHeaders(
  contentType: string | undefined,
): HeadersInit | undefined {
  return contentType === undefined
    ? undefined
    : { "Content-Type": contentType };
}

function deleteStatuses(force: boolean | undefined): readonly number[] {
  return force ? [200, 204, 404] : [200, 204];
}

function isNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.status === 404;
}

function pathBaseName(path: string): string {
  const normalized = normalizeRemotePath(path);
  const cleaned = cleanTrailingSlashes(normalized);
  return decodeURIComponent(cleaned.slice(cleaned.lastIndexOf("/") + 1));
}

function parentPath(path: string): string {
  const normalized = cleanTrailingSlashes(normalizeRemotePath(path));
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return decodeURIComponent(normalized.slice(0, index));
}

function readFileEncoding(
  options: FileSystemReadFileOptions | string | null | undefined,
): string | null {
  if (typeof options === "string") return options;
  return options?.encoding === undefined ? null : options.encoding;
}

function readFileSignal(
  options: FileSystemReadFileOptions | string | null | undefined,
): AbortSignal | undefined {
  return typeof options === "string" ? undefined : options?.signal;
}

function textContentHeaders(
  contentType: string | undefined,
  data: FileSystemWriteData,
): HeadersInit | undefined {
  if (contentType !== undefined) return { "Content-Type": contentType };
  return typeof data === "string"
    ? { "Content-Type": "text/plain; charset=utf-8" }
    : undefined;
}

function bodyRequiresDuplex(body: BodyInit | undefined): boolean {
  return (
    typeof ReadableStream !== "undefined" && body instanceof ReadableStream
  );
}

function requestInit(
  config: FileSystemConfig,
  method: string,
  options: FileSystemRequest,
): FileSystemFetchInit {
  return {
    body: options.body,
    duplex: bodyRequiresDuplex(options.body) ? "half" : undefined,
    headers: requestHeaders(config, options.headers),
    method,
    signal: options.signal,
  };
}

async function resolveURL(url: FileSystemURLProvider): Promise<string | URL> {
  return typeof url === "function" ? await url() : url;
}

function elementBodies(xml: string, name: string): string[] {
  return Array.from(
    xml.matchAll(
      new RegExp(
        `<[^>]*:?${name}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`,
        "gi",
      ),
    ),
    (match) => match[1] ?? "",
  );
}

function hasElement(xml: string, name: string): boolean {
  return new RegExp(`<[^>]*:?${name}(\\s|/|>)`, "i").test(xml);
}

function stripTags(xml: string): string {
  return xml.replace(/<[^>]*>/g, "");
}

function decodeNumericEntity(value: string): string {
  const parsed = value.startsWith("&#x")
    ? Number.parseInt(value.slice(3, -1), 16)
    : Number.parseInt(value.slice(2, -1), 10);
  return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : value;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x[0-9a-f]+;|&#\d+;/gi, decodeNumericEntity)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function elementText(xml: string, name: string): string {
  return decodeXmlText(stripTags(elementBodies(xml, name)[0] ?? ""));
}

function okPropstat(response: string): string {
  return (
    elementBodies(response, "propstat").find((propstat) =>
      elementText(propstat, "status").includes(" 200 "),
    ) ?? ""
  );
}

function safeDecodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function hrefPath(href: string): string {
  return safeDecodePath(new URL(href, "http://rstream.local").pathname);
}

function displayPath(href: string, fsPath: string): string {
  const value = hrefPath(href);
  const sidecar = cleanTrailingSlashes(decodeURIComponent(sidecarPath(fsPath)));
  const withoutFS =
    value === sidecar
      ? "/"
      : value.startsWith(`${sidecar}/`)
        ? value.slice(sidecar.length)
        : value;
  return withoutFS === "" ? "/" : withoutFS;
}

function itemSize(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function itemFromResponse(
  response: string,
  fsPath: string,
): FileSystemItem | null {
  const propstat = okPropstat(response);
  const path = displayPath(elementText(response, "href"), fsPath);
  if (propstat === "" || path === "") return null;
  return {
    kind: hasElement(
      elementBodies(propstat, "resourcetype")[0] ?? "",
      "collection",
    )
      ? "directory"
      : "file",
    modified: elementText(propstat, "getlastmodified") || undefined,
    path,
    size: itemSize(elementText(propstat, "getcontentlength")),
  };
}

function presentItems(
  items: readonly (FileSystemItem | null)[],
): FileSystemItem[] {
  return items.filter((item): item is FileSystemItem => item !== null);
}

export function parseWebDAVMultiStatus(
  xml: string,
  fsPath = "/fs",
): FileSystemItem[] {
  return presentItems(
    elementBodies(xml, "response").map((response) =>
      itemFromResponse(response, fsPath),
    ),
  );
}

export class WebDAVFileSystem implements FileSystemBackend {
  private readonly config: FileSystemConfig;

  public constructor(config: FileSystemConfig) {
    this.config = config;
  }

  public async list(
    path = "/",
    options: FileSystemRequestOptions = {},
  ): Promise<FileSystemItem[]> {
    const response = await this.request("PROPFIND", path, {
      body: webDAVPropfindBody,
      expectedStatuses: [207],
      headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
      operation: "Filesystem list",
      signal: options.signal,
    });
    return parseWebDAVMultiStatus(
      await response.text(),
      decodeURIComponent(sidecarPath(this.config.fsPath)),
    );
  }

  public async readBytes(
    path: string,
    options: FileSystemRequestOptions = {},
  ): Promise<Uint8Array> {
    const response = await this.request("GET", path, {
      expectedStatuses: [200],
      operation: "Filesystem read",
      signal: options.signal,
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  public async readFile(
    path: string,
    options?: { encoding?: null; signal?: AbortSignal } | null,
  ): Promise<Uint8Array>;
  public async readFile(
    path: string,
    options: { encoding: string; signal?: AbortSignal } | string,
  ): Promise<string>;
  public async readFile(
    path: string,
    options?: FileSystemReadFileOptions | string | null,
  ): Promise<string | Uint8Array> {
    const bytes = await this.readBytes(path, {
      signal: readFileSignal(options),
    });
    const encoding = readFileEncoding(options);
    return encoding === null ? bytes : new TextDecoder(encoding).decode(bytes);
  }

  public async readText(
    path: string,
    options: FileSystemRequestOptions = {},
  ): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path, options));
  }

  public async readStream(
    path: string,
    options: FileSystemStreamOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    return requireResponseBody(
      await this.request("GET", path, {
        expectedStatuses: options.range ? [206] : [200],
        headers: options.range ? { Range: options.range } : undefined,
        operation: "Filesystem read",
        signal: options.signal,
      }),
      "Filesystem read",
    );
  }

  public async writeFile(
    path: string,
    data: FileSystemWriteData,
    options: FileSystemWriteFileOptions = {},
  ): Promise<void> {
    await this.request("PUT", path, {
      body: data,
      expectedStatuses: [200, 201, 204],
      headers: textContentHeaders(options.contentType, data),
      operation: "Filesystem write",
      signal: options.signal,
    });
  }

  public async writeBytes(
    path: string,
    data: BodyInit,
    options: FileSystemRequestOptions = {},
  ): Promise<void> {
    await this.writeFile(path, data, options);
  }

  public async writeStream(
    path: string,
    data: ReadableStream<Uint8Array>,
    options: FileSystemWriteStreamOptions = {},
  ): Promise<void> {
    await this.request("PUT", path, {
      body: data,
      expectedStatuses: [200, 201, 204],
      headers: contentHeaders(options.contentType),
      operation: "Filesystem write",
      signal: options.signal,
    });
  }

  public async writeText(
    path: string,
    data: string,
    options: FileSystemRequestOptions = {},
  ): Promise<void> {
    await this.writeFile(path, data, options);
  }

  public async copyFile(
    sourcePath: string,
    targetPath: string,
    options: FileSystemRequestOptions = {},
  ): Promise<void> {
    await this.request("COPY", sourcePath, {
      expectedStatuses: [200, 201, 204],
      headers: { Destination: (await this.resourceURL(targetPath)).toString() },
      operation: "Filesystem copy",
      signal: options.signal,
    });
  }

  public async createDirectory(
    path: string,
    options: FileSystemRequestOptions = {},
  ): Promise<void> {
    await this.request("MKCOL", path, {
      expectedStatuses: [201, 405],
      operation: "Filesystem mkdir",
      signal: options.signal,
    });
  }

  public async exists(
    path: string,
    options: FileSystemRequestOptions = {},
  ): Promise<boolean> {
    return await this.stat(path, options)
      .then(() => true)
      .catch((error) => {
        if (isNotFound(error)) return false;
        throw error;
      });
  }

  public async mkdir(
    path: string,
    options: FileSystemMkdirOptions = {},
  ): Promise<string | undefined> {
    if (options.recursive) {
      if (normalizeRemotePath(path) === "/") {
        await this.createDirectory(path, options);
        return "/";
      }
      await this.createDirectoryRecursive(path, options.signal);
      return decodeURIComponent(normalizeRemotePath(path));
    }
    await this.createDirectory(path, options);
    return undefined;
  }

  public async readdir(
    path: string,
    options: FileSystemReaddirOptions & { withFileTypes: true },
  ): Promise<FileSystemItem[]>;
  public async readdir(
    path?: string,
    options?: FileSystemReaddirOptions,
  ): Promise<string[]>;
  public async readdir(
    path = "/",
    options: FileSystemReaddirOptions = {},
  ): Promise<string[] | FileSystemItem[]> {
    const items = (await this.list(path, options)).filter(
      (item) => comparableRemotePath(item.path) !== comparableRemotePath(path),
    );
    return options.withFileTypes
      ? items
      : items.map((item) => pathBaseName(item.path));
  }

  public async rename(
    oldPath: string,
    newPath: string,
    options: FileSystemRequestOptions = {},
  ): Promise<void> {
    await this.request("MOVE", oldPath, {
      expectedStatuses: [200, 201, 204],
      headers: { Destination: (await this.resourceURL(newPath)).toString() },
      operation: "Filesystem rename",
      signal: options.signal,
    });
  }

  public async rm(
    path: string,
    options: FileSystemRmOptions = {},
  ): Promise<void> {
    void options.recursive;
    await this.request("DELETE", path, {
      expectedStatuses: deleteStatuses(options.force),
      operation: "Filesystem delete",
      signal: options.signal,
    });
  }

  public async stat(
    path: string,
    options: FileSystemRequestOptions = {},
  ): Promise<FileSystemItem> {
    const response = await this.request("PROPFIND", path, {
      body: webDAVPropfindBody,
      expectedStatuses: [207],
      headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "0" },
      operation: "Filesystem stat",
      signal: options.signal,
    });
    const item = parseWebDAVMultiStatus(
      await response.text(),
      decodeURIComponent(sidecarPath(this.config.fsPath)),
    )[0];
    if (item) return item;
    throw new Error(`Filesystem stat did not return ${path}.`);
  }

  public async delete(
    path: string,
    options: FileSystemRequestOptions = {},
  ): Promise<void> {
    await this.rm(path, options);
  }

  private async createDirectoryRecursive(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const normalized = normalizeRemotePath(path);
    if (normalized === "/") return;
    const parent = parentPath(decodeURIComponent(normalized));
    if (parent !== normalized) {
      await this.createDirectoryRecursive(parent, signal);
    }
    await this.createDirectory(decodeURIComponent(normalized), { signal });
  }

  public async archiveStream(
    path = "/",
    options: FileSystemRequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const url = new URL(await this.resourceURL("/"));
    url.pathname = this.config.archivePath ?? "/_rstream/files/v1/archive";
    url.searchParams.set("path", path);
    const response = await resolveFetch(this.config)(
      url,
      requestInit(this.config, "GET", {
        expectedStatuses: [200],
        operation: "Filesystem archive",
        signal: options.signal,
      }),
    );
    if (response.status !== 200)
      throw this.createError(
        "Filesystem archive",
        response.status,
        await responseErrorMessage(response),
      );
    return requireResponseBody(response, "Filesystem archive");
  }
  public async downloadURL(path: string): Promise<URL> {
    if (
      this.config.authToken ||
      new Headers(this.config.headers).has("Authorization")
    ) {
      throw new Error(
        "Header-authenticated downloads require readStream instead of a browser link.",
      );
    }
    return await this.resourceURL(path);
  }

  private async resourceURL(path: string): Promise<URL> {
    return resolveFileSystemURL(
      await resolveURL(this.config.url),
      path,
      this.config.fsPath,
    );
  }

  private async request(
    method: string,
    path: string,
    options: FileSystemRequest,
  ): Promise<Response> {
    const response = await resolveFetch(this.config)(
      await this.resourceURL(path),
      requestInit(this.config, method, options),
    );
    if (responseAllowed(response, options.expectedStatuses)) return response;
    throw this.createError(
      options.operation,
      response.status,
      await responseErrorMessage(response),
    );
  }

  protected createError(
    operation: string,
    status: number,
    message: string,
  ): FileSystemError {
    return new FileSystemError(operation, status, message);
  }
}
