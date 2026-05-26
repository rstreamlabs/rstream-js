// See LICENSE file in the project root for license information.

import type { WebTTYURLProvider } from "./execution";

export interface WebTTYFileSystemConfig {
  authToken?: string;
  fetch?: typeof fetch;
  fsPath?: string;
  headers?: HeadersInit;
  url: WebTTYURLProvider;
}

export interface WebTTYFileSystemItem {
  kind: "directory" | "file";
  modified?: string;
  path: string;
  size?: number;
}

export interface WebTTYFileSystemRequestOptions {
  signal?: AbortSignal;
}

export interface WebTTYFileSystemReadFileOptions extends WebTTYFileSystemRequestOptions {
  encoding?: string | null;
}

export interface WebTTYFileSystemMkdirOptions extends WebTTYFileSystemRequestOptions {
  recursive?: boolean;
}

export interface WebTTYFileSystemReaddirOptions extends WebTTYFileSystemRequestOptions {
  withFileTypes?: boolean;
}

export interface WebTTYFileSystemRmOptions extends WebTTYFileSystemRequestOptions {
  force?: boolean;
  recursive?: boolean;
}

export interface WebTTYFileSystemWriteFileOptions extends WebTTYFileSystemRequestOptions {
  contentType?: string;
}

export interface WebTTYFileSystemWriteStreamOptions extends WebTTYFileSystemRequestOptions {
  contentType?: string;
}

export type WebTTYFileSystemWriteData = BodyInit;

interface WebTTYFileSystemFetchInit extends RequestInit {
  duplex?: "half";
}

interface WebTTYFileSystemRequest {
  body?: BodyInit;
  expectedStatuses: readonly number[];
  headers?: HeadersInit;
  operation: string;
  signal?: AbortSignal;
}

export class WebTTYFileSystemError extends Error {
  public readonly operation: string;
  public readonly status: number;
  public constructor(operation: string, status: number, message: string) {
    super(`${operation} failed with status ${status}: ${message}`);
    this.name = "WebTTYFileSystemError";
    this.operation = operation;
    this.status = status;
  }
}

const webDAVPropfindBody =
  '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>';

function cleanTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeRemotePath(remotePath: string): string {
  const trimmed = remotePath.trim();
  const absolute = trimmed === "" || trimmed === "." ? "/" : trimmed;
  return new URL(
    absolute.startsWith("/") ? absolute : `/${absolute}`,
    "http://rstream.local",
  ).pathname;
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

export function resolveWebTTYFileSystemURL(
  input: string | URL,
  remotePath = "/",
  fsPath?: string,
): URL {
  const url = new URL(input.toString());
  if (url.protocol === "rstrm:") {
    throw new Error(
      "rstrm:// WebTTY filesystem URLs require the native rstream dialer.",
    );
  }
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Unsupported WebTTY filesystem URL scheme "${url.protocol}".`,
    );
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
  const text = (await response.text()).trim().slice(0, 4096);
  return text === "" ? response.statusText : text;
}

async function requireResponseStatus(
  response: Response,
  expectedStatuses: readonly number[],
  operation: string,
): Promise<Response> {
  if (responseAllowed(response, expectedStatuses)) return response;
  throw new WebTTYFileSystemError(
    operation,
    response.status,
    await responseErrorMessage(response),
  );
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

function resolveFetch(config: WebTTYFileSystemConfig): typeof fetch {
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
  config: WebTTYFileSystemConfig,
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
  return error instanceof WebTTYFileSystemError && error.status === 404;
}

function pathBaseName(path: string): string {
  const normalized = normalizeRemotePath(path);
  const cleaned = cleanTrailingSlashes(normalized);
  return cleaned.slice(cleaned.lastIndexOf("/") + 1);
}

function parentPath(path: string): string {
  const normalized = cleanTrailingSlashes(normalizeRemotePath(path));
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}

function readFileEncoding(
  options: WebTTYFileSystemReadFileOptions | string | null | undefined,
): string | null {
  if (typeof options === "string") return options;
  return options?.encoding === undefined ? null : options.encoding;
}

function readFileSignal(
  options: WebTTYFileSystemReadFileOptions | string | null | undefined,
): AbortSignal | undefined {
  return typeof options === "string" ? undefined : options?.signal;
}

function textContentHeaders(
  contentType: string | undefined,
  data: WebTTYFileSystemWriteData,
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
  config: WebTTYFileSystemConfig,
  method: string,
  options: WebTTYFileSystemRequest,
): WebTTYFileSystemFetchInit {
  return {
    body: options.body,
    duplex: bodyRequiresDuplex(options.body) ? "half" : undefined,
    headers: requestHeaders(config, options.headers),
    method,
    signal: options.signal,
  };
}

async function resolveURL(url: WebTTYURLProvider): Promise<string | URL> {
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
  return decodeXmlText(stripTags(elementBodies(xml, name)[0] ?? "")).trim();
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
  const sidecar = cleanTrailingSlashes(sidecarPath(fsPath));
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
): WebTTYFileSystemItem | null {
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
  items: readonly (WebTTYFileSystemItem | null)[],
): WebTTYFileSystemItem[] {
  return items.filter((item): item is WebTTYFileSystemItem => item !== null);
}

export function parseWebDAVMultiStatus(
  xml: string,
  fsPath = "/fs",
): WebTTYFileSystemItem[] {
  return presentItems(
    elementBodies(xml, "response").map((response) =>
      itemFromResponse(response, fsPath),
    ),
  );
}

export class WebTTYFileSystem {
  private readonly config: WebTTYFileSystemConfig;

  public constructor(config: WebTTYFileSystemConfig) {
    this.config = config;
  }

  public async list(
    path = "/",
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<WebTTYFileSystemItem[]> {
    const response = await this.request("PROPFIND", path, {
      body: webDAVPropfindBody,
      expectedStatuses: [207],
      headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
      operation: "WebTTY filesystem list",
      signal: options.signal,
    });
    return parseWebDAVMultiStatus(
      await response.text(),
      sidecarPath(this.config.fsPath),
    );
  }

  public async readBytes(
    path: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<Uint8Array> {
    const response = await this.request("GET", path, {
      expectedStatuses: [200],
      operation: "WebTTY filesystem read",
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
    options?: WebTTYFileSystemReadFileOptions | string | null,
  ): Promise<string | Uint8Array> {
    const bytes = await this.readBytes(path, {
      signal: readFileSignal(options),
    });
    const encoding = readFileEncoding(options);
    return encoding === null ? bytes : new TextDecoder(encoding).decode(bytes);
  }

  public async readText(
    path: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path, options));
  }

  public async readStream(
    path: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    return requireResponseBody(
      await this.request("GET", path, {
        expectedStatuses: [200],
        operation: "WebTTY filesystem read",
        signal: options.signal,
      }),
      "WebTTY filesystem read",
    );
  }

  public async writeFile(
    path: string,
    data: WebTTYFileSystemWriteData,
    options: WebTTYFileSystemWriteFileOptions = {},
  ): Promise<void> {
    await this.request("PUT", path, {
      body: data,
      expectedStatuses: [200, 201, 204],
      headers: textContentHeaders(options.contentType, data),
      operation: "WebTTY filesystem write",
      signal: options.signal,
    });
  }

  public async writeBytes(
    path: string,
    data: BodyInit,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<void> {
    await this.writeFile(path, data, options);
  }

  public async writeStream(
    path: string,
    data: ReadableStream<Uint8Array>,
    options: WebTTYFileSystemWriteStreamOptions = {},
  ): Promise<void> {
    await this.request("PUT", path, {
      body: data,
      expectedStatuses: [200, 201, 204],
      headers: contentHeaders(options.contentType),
      operation: "WebTTY filesystem write",
      signal: options.signal,
    });
  }

  public async writeText(
    path: string,
    data: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<void> {
    await this.writeFile(path, data, options);
  }

  public async copyFile(
    sourcePath: string,
    targetPath: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<void> {
    await this.request("COPY", sourcePath, {
      expectedStatuses: [200, 201, 204],
      headers: { Destination: (await this.resourceURL(targetPath)).toString() },
      operation: "WebTTY filesystem copy",
      signal: options.signal,
    });
  }

  public async createDirectory(
    path: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<void> {
    await this.request("MKCOL", path, {
      expectedStatuses: [201, 405],
      operation: "WebTTY filesystem mkdir",
      signal: options.signal,
    });
  }

  public async exists(
    path: string,
    options: WebTTYFileSystemRequestOptions = {},
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
    options: WebTTYFileSystemMkdirOptions = {},
  ): Promise<string | undefined> {
    if (options.recursive) {
      await this.createDirectoryRecursive(path, options.signal);
      return normalizeRemotePath(path);
    }
    await this.createDirectory(path, options);
    return undefined;
  }

  public async readdir(
    path: string,
    options: WebTTYFileSystemReaddirOptions & { withFileTypes: true },
  ): Promise<WebTTYFileSystemItem[]>;
  public async readdir(
    path?: string,
    options?: WebTTYFileSystemReaddirOptions,
  ): Promise<string[]>;
  public async readdir(
    path = "/",
    options: WebTTYFileSystemReaddirOptions = {},
  ): Promise<string[] | WebTTYFileSystemItem[]> {
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
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<void> {
    await this.request("MOVE", oldPath, {
      expectedStatuses: [200, 201, 204],
      headers: { Destination: (await this.resourceURL(newPath)).toString() },
      operation: "WebTTY filesystem rename",
      signal: options.signal,
    });
  }

  public async rm(
    path: string,
    options: WebTTYFileSystemRmOptions = {},
  ): Promise<void> {
    void options.recursive;
    await this.request("DELETE", path, {
      expectedStatuses: deleteStatuses(options.force),
      operation: "WebTTY filesystem delete",
      signal: options.signal,
    });
  }

  public async stat(
    path: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<WebTTYFileSystemItem> {
    const response = await this.request("PROPFIND", path, {
      body: webDAVPropfindBody,
      expectedStatuses: [207],
      headers: { "Content-Type": "application/xml; charset=utf-8", Depth: "0" },
      operation: "WebTTY filesystem stat",
      signal: options.signal,
    });
    const item = parseWebDAVMultiStatus(
      await response.text(),
      sidecarPath(this.config.fsPath),
    )[0];
    if (item) return item;
    throw new Error(`WebTTY filesystem stat did not return ${path}.`);
  }

  public async delete(
    path: string,
    options: WebTTYFileSystemRequestOptions = {},
  ): Promise<void> {
    await this.rm(path, options);
  }

  private async createDirectoryRecursive(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const normalized = normalizeRemotePath(path);
    if (normalized === "/") return;
    const parent = parentPath(normalized);
    if (parent !== normalized) {
      await this.createDirectoryRecursive(parent, signal);
    }
    await this.createDirectory(normalized, { signal });
  }

  private async resourceURL(path: string): Promise<URL> {
    return resolveWebTTYFileSystemURL(
      await resolveURL(this.config.url),
      path,
      this.config.fsPath,
    );
  }

  private async request(
    method: string,
    path: string,
    options: WebTTYFileSystemRequest,
  ): Promise<Response> {
    return await requireResponseStatus(
      await resolveFetch(this.config)(
        await this.resourceURL(path),
        requestInit(this.config, method, options),
      ),
      options.expectedStatuses,
      options.operation,
    );
  }
}
