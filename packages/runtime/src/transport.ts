// See LICENSE file in the project root for license information.

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { RuntimeError } from "./errors";
import net from "node:net";
import os from "node:os";
import tls from "node:tls";
import type { RuntimeTLSOptions } from "./config";
import type { TLSSocket } from "node:tls";
import type { TransportConfig } from "./config";

export interface TransportDialOptions {
  address: string;
  alpnProtocols?: string[];
  signal?: AbortSignal;
  tls?: RuntimeTLSOptions;
}

export interface Transport {
  dial(options: TransportDialOptions): Promise<TLSSocket>;
}

interface NodeTransportOptions {
  localAddress?: string;
  family?: 4 | 6;
  proxy?: ProxyOptions;
  proxyFromEnvironment?: ProxyDefaults;
}

interface ProxyOptions {
  headers?: Record<string, string>;
  url: string;
  tls?: ProxyTLSOptions;
  username?: string;
  password?: string;
}

interface ProxyDefaults {
  headers?: Record<string, string>;
  tls?: ProxyTLSOptions;
  username?: string;
  password?: string;
}

interface ProxyTLSOptions {
  caFile?: string;
  insecureSkipVerify?: boolean;
  serverName?: string;
}

interface HostPort {
  host: string;
  port: number;
  authority: string;
}

interface HeaderReadResult {
  header: string;
  rest: Buffer;
}

export class NodeTransport implements Transport {
  public readonly options: NodeTransportOptions;

  constructor(options?: NodeTransportOptions) {
    this.options = options ?? {};
  }

  public async dial(options: TransportDialOptions): Promise<TLSSocket> {
    const target = parseHostPort(options.address, 443);
    const proxy =
      this.options.proxy ??
      (this.options.proxyFromEnvironment === undefined
        ? undefined
        : proxyFromEnvironment(target, this.options.proxyFromEnvironment));
    const socket =
      proxy === undefined
        ? await this.dialDirect(target, options.signal)
        : await this.dialProxy(target, proxy, options.signal);
    return await this.startTls(socket, target, options);
  }

  private async dialDirect(
    target: HostPort,
    signal?: AbortSignal,
  ): Promise<net.Socket> {
    return await connectTcp({
      family: this.options.family,
      host: target.host,
      localAddress: this.options.localAddress,
      port: target.port,
      signal,
    });
  }

  private async dialProxy(
    target: HostPort,
    proxy: ProxyOptions,
    signal?: AbortSignal,
  ): Promise<net.Socket> {
    const proxyUrl = new URL(proxy.url);
    if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
      throw new RuntimeError("HTTP proxy URL must use http:// or https://.", {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      });
    }
    const proxyTarget = parseHostPort(
      proxyUrl.host,
      proxyUrl.protocol === "https:" ? 443 : 80,
    );
    const normalizedProxy = proxyWithURLCredentials(proxy, proxyUrl);
    if (proxyUrl.protocol === "http:" && normalizedProxy.tls !== undefined) {
      throw new RuntimeError("Proxy TLS config requires an HTTPS proxy URL.", {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      });
    }
    const raw = await connectTcp({
      family: this.options.family,
      host: proxyTarget.host,
      localAddress: this.options.localAddress,
      port: proxyTarget.port,
      signal,
    });
    let socket: net.Socket | TLSSocket = raw;
    try {
      socket =
        proxyUrl.protocol === "https:"
          ? await startProxyTls(raw, proxyTarget, normalizedProxy.tls, signal)
          : raw;
      await writeConnectRequest(socket, target, normalizedProxy, signal);
      return socket;
    } catch (error) {
      socket.destroy();
      if (socket !== raw) raw.destroy();
      throw error;
    }
  }

  private async startTls(
    socket: net.Socket,
    target: HostPort,
    options: TransportDialOptions,
  ): Promise<TLSSocket> {
    const servername =
      options.tls?.servername ??
      (net.isIP(target.host) === 0 ? target.host : undefined);
    return await connectTls(
      {
        ...options.tls,
        ALPNProtocols: options.alpnProtocols,
        servername,
        socket,
      },
      options.signal,
    );
  }
}

export function transportFromConfig(
  config?: TransportConfig,
): Transport | undefined {
  if (config === undefined) return undefined;
  const mode = config.mode?.trim().toLowerCase();
  if (
    mode !== undefined &&
    mode !== "auto" &&
    mode !== "tls" &&
    mode !== "quic"
  ) {
    throw new RuntimeError(
      `Invalid tunnel transport "${config.mode}" (valid: auto, tls, quic).`,
      { code: "ERR_RSTREAM_INVALID_CONFIG" },
    );
  }
  if (mode === "quic" || (mode === undefined && config.useQuic === true)) {
    throw new RuntimeError(
      "QUIC transport is not supported by @rstreamlabs/runtime.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT",
      },
    );
  }
  if (
    config.dns?.override !== undefined ||
    config.dns?.tls !== undefined ||
    config.dns?.dnssec !== undefined ||
    config.dns?.serverName !== undefined
  ) {
    throw new RuntimeError(
      "Custom DNS transport config is not supported by @rstreamlabs/runtime.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
  if (config.mptcp === true) {
    throw new RuntimeError(
      "MPTCP transport config is not supported by Node.js.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
  const family =
    config.ipFamily === "ipv4" ? 4 : config.ipFamily === "ipv6" ? 6 : undefined;
  const localAddress = localAddressFromBind(config.bind, family);
  const proxy = proxyFromConfig(config.proxy);
  const proxyFromEnvironment =
    config.proxy?.fromEnvironment === true
      ? proxyDefaultsFromConfig(config.proxy)
      : undefined;
  return new NodeTransport({
    family,
    localAddress,
    proxy,
    proxyFromEnvironment,
  });
}

function proxyFromConfig(
  proxy?: TransportConfig["proxy"],
): ProxyOptions | undefined {
  if (proxy === undefined) return undefined;
  if (proxy.http !== undefined && proxy.socks5 !== undefined) {
    throw new RuntimeError("Only one proxy transport can be configured.", {
      code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
    });
  }
  if (proxy.socks5 !== undefined) {
    throw new RuntimeError(
      "SOCKS5 proxy transport config is not supported by @rstreamlabs/runtime.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
  validateProxyTLSConfig(proxy);
  validateProxyCredentials(proxy.username, proxy.password);
  if (proxy.http === undefined) return undefined;
  validateHTTPProxyURL(proxy.http);
  return {
    headers: proxy.headers,
    password: proxy.password,
    tls: proxy.tls,
    url: proxy.http,
    username: proxy.username,
  };
}

function proxyDefaultsFromConfig(
  proxy: TransportConfig["proxy"],
): ProxyDefaults {
  validateProxyTLSConfig(proxy);
  validateProxyCredentials(proxy?.username, proxy?.password);
  return {
    headers: proxy?.headers,
    password: proxy?.password,
    tls: proxy?.tls,
    username: proxy?.username,
  };
}

function validateProxyTLSConfig(proxy?: TransportConfig["proxy"]): void {
  if (proxy?.tls === undefined) return;
  if (proxy.socks5 !== undefined) {
    throw new RuntimeError(
      "Proxy TLS config can only be used with HTTP proxy transport.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
  if (proxy.http === undefined && proxy.fromEnvironment !== true) {
    throw new RuntimeError(
      "Proxy TLS config requires proxy.http or proxy.fromEnvironment.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
}

function validateProxyCredentials(username?: string, password?: string): void {
  if ((username === undefined) !== (password === undefined)) {
    throw new RuntimeError(
      "Proxy username and password must be configured together.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
}

function validateHTTPProxyURL(raw: string): void {
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(raw);
  } catch (cause) {
    throw new RuntimeError("Invalid HTTP proxy URL.", {
      cause,
      code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
    });
  }
  if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
    throw new RuntimeError("HTTP proxy URL must use http:// or https://.", {
      code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
    });
  }
}

function localAddressFromBind(
  bind?: TransportConfig["bind"],
  family?: 4 | 6,
): string | undefined {
  if (bind === undefined) return undefined;
  if (bind.mode === "interface") {
    if (bind.interface === undefined) return undefined;
    return addressForInterface(bind.interface, family);
  }
  return bind.address;
}

function addressForInterface(name: string, family?: 4 | 6): string {
  const addresses = os.networkInterfaces()[name];
  const selected = addresses?.find((entry) => {
    if (entry.internal) return false;
    if (family === 4) return entry.family === "IPv4";
    if (family === 6) return entry.family === "IPv6";
    return true;
  });
  if (selected === undefined) {
    throw new RuntimeError(
      `No usable address found for network interface "${name}".`,
      {
        code: "ERR_RSTREAM_TRANSPORT_BIND",
      },
    );
  }
  return selected.address;
}

function parseHostPort(value: string, defaultPort: number): HostPort {
  const url = new URL(`rstrm://${value}`);
  if (!url.hostname) {
    throw new RuntimeError(`Invalid host:port address "${value}".`, {
      code: "ERR_RSTREAM_INVALID_ADDRESS",
    });
  }
  const port = url.port ? Number(url.port) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RuntimeError(`Invalid port in address "${value}".`, {
      code: "ERR_RSTREAM_INVALID_ADDRESS",
    });
  }
  return {
    authority: `${url.hostname}:${port}`,
    host: url.hostname,
    port,
  };
}

function proxyFromEnvironment(
  target: HostPort,
  defaults: ProxyDefaults,
): ProxyOptions | undefined {
  if (noProxyMatches(target)) return undefined;
  const raw = firstEnv(
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
  );
  if (raw === undefined) return undefined;
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch (cause) {
    throw new RuntimeError("Invalid proxy URL from environment.", {
      cause,
      code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
    });
  }
  if (proxyUrl.protocol === "socks5:" || proxyUrl.protocol === "socks5h:") {
    throw new RuntimeError(
      "SOCKS5 proxy transport config from environment is not supported by @rstreamlabs/runtime.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
  if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
    throw new RuntimeError(
      `Unsupported proxy URL scheme "${proxyUrl.protocol.replace(":", "")}" from environment.`,
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TRANSPORT_CONFIG",
      },
    );
  }
  return proxyWithURLCredentials(
    {
      ...defaults,
      url: proxyUrl.toString(),
    },
    proxyUrl,
  );
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function noProxyMatches(target: HostPort): boolean {
  const noProxy = firstEnv("NO_PROXY", "no_proxy");
  if (noProxy === undefined) return false;
  const targetHost = stripBrackets(target.host).toLowerCase();
  for (const rawEntry of noProxy.split(",")) {
    const entry = rawEntry.trim().toLowerCase();
    if (entry === "") continue;
    if (entry === "*") return true;
    const [entryHost, entryPort] = noProxyHostPort(entry);
    if (entryPort !== undefined && entryPort !== target.port) continue;
    if (entryHost.startsWith(".")) {
      if (targetHost.endsWith(entryHost)) return true;
      continue;
    }
    if (targetHost === entryHost || targetHost.endsWith(`.${entryHost}`)) {
      return true;
    }
  }
  return false;
}

function noProxyHostPort(entry: string): [string, number | undefined] {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
  if (bracketed !== null) {
    return [bracketed[1] ?? "", portFromString(bracketed[2])];
  }
  const lastColon = entry.lastIndexOf(":");
  if (lastColon > -1 && entry.indexOf(":") === lastColon) {
    const port = portFromString(entry.slice(lastColon + 1));
    if (port !== undefined) return [entry.slice(0, lastColon), port];
  }
  return [stripBrackets(entry), undefined];
}

function portFromString(value?: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? port
    : undefined;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function proxyWithURLCredentials(
  proxy: ProxyOptions,
  proxyUrl: URL,
): ProxyOptions {
  validateProxyCredentials(proxy.username, proxy.password);
  if (proxy.username !== undefined) return proxy;
  if (proxyUrl.username === "" && proxyUrl.password === "") return proxy;
  return {
    ...proxy,
    password: decodeURIComponent(proxyUrl.password),
    username: decodeURIComponent(proxyUrl.username),
  };
}

function connectTcp(
  options: net.NetConnectOpts & { signal?: AbortSignal },
): Promise<net.Socket> {
  const { signal, ...connectOptions } = options;
  if (signal?.aborted) {
    return Promise.reject(
      new RuntimeError("TCP dial aborted.", {
        code: "ERR_RSTREAM_DIAL_ABORTED",
      }),
    );
  }
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(connectOptions);
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(
        new RuntimeError("TCP dial aborted.", {
          code: "ERR_RSTREAM_DIAL_ABORTED",
        }),
      );
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function connectTls(
  options: tls.ConnectionOptions,
  signal?: AbortSignal,
): Promise<TLSSocket> {
  if (signal?.aborted) {
    return Promise.reject(
      new RuntimeError("TLS dial aborted.", {
        code: "ERR_RSTREAM_DIAL_ABORTED",
      }),
    );
  }
  return new Promise<TLSSocket>((resolve, reject) => {
    const socket = tls.connect(options);
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(
        new RuntimeError("TLS dial aborted.", {
          code: "ERR_RSTREAM_DIAL_ABORTED",
        }),
      );
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      socket.off("secureConnect", onSecureConnect);
      socket.off("error", onError);
    };
    const onSecureConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("secureConnect", onSecureConnect);
    socket.once("error", onError);
  });
}

async function startProxyTls(
  socket: net.Socket,
  proxy: HostPort,
  proxyTls?: ProxyTLSOptions,
  signal?: AbortSignal,
): Promise<TLSSocket> {
  const ca =
    proxyTls?.caFile === undefined
      ? undefined
      : await readFile(proxyTls.caFile, "utf8");
  return await connectTls(
    {
      ca,
      rejectUnauthorized:
        proxyTls?.insecureSkipVerify === true ? false : undefined,
      servername: proxyTls?.serverName ?? proxy.host,
      socket,
    },
    signal,
  );
}

async function writeConnectRequest(
  socket: net.Socket,
  target: HostPort,
  proxy: NonNullable<NodeTransportOptions["proxy"]>,
  signal?: AbortSignal,
): Promise<void> {
  const headers = {
    Host: target.authority,
    ...proxy.headers,
    ...proxyAuthHeader(proxy),
  };
  const request = [
    `CONNECT ${target.authority} HTTP/1.1`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    "",
    "",
  ].join("\r\n");
  await writeRaw(socket, Buffer.from(request, "utf8"));
  const response = await readHTTPHeader(socket, signal);
  const statusLine = response.header.split("\r\n")[0] ?? "";
  if (!/^HTTP\/1\.[01] 200(?:\s|$)/.test(statusLine)) {
    throw new RuntimeError(
      `HTTP proxy CONNECT failed: ${statusLine || "empty response"}.`,
      {
        code: "ERR_RSTREAM_PROXY_CONNECT",
      },
    );
  }
  if (response.rest.length > 0) socket.unshift(response.rest);
}

function proxyAuthHeader(
  proxy: NonNullable<NodeTransportOptions["proxy"]>,
): Record<string, string> {
  if (proxy.username === undefined || proxy.password === undefined) return {};
  const credentials = Buffer.from(
    `${proxy.username}:${proxy.password}`,
    "utf8",
  ).toString("base64");
  return { "Proxy-Authorization": `Basic ${credentials}` };
}

function writeRaw(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.write(data, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readHTTPHeader(
  socket: net.Socket,
  signal?: AbortSignal,
): Promise<HeaderReadResult> {
  if (signal?.aborted) {
    return Promise.reject(
      new RuntimeError("HTTP proxy CONNECT aborted.", {
        code: "ERR_RSTREAM_DIAL_ABORTED",
      }),
    );
  }
  return new Promise<HeaderReadResult>((resolve, reject) => {
    const state = { buffer: Buffer.alloc(0) };
    const onAbort = () => {
      socket.destroy();
      rejectWithCleanup(
        new RuntimeError("HTTP proxy CONNECT aborted.", {
          code: "ERR_RSTREAM_DIAL_ABORTED",
        }),
      );
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      socket.off("data", onData);
      socket.off("error", rejectWithCleanup);
      socket.off("close", onClose);
    };
    const rejectWithCleanup = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () =>
      rejectWithCleanup(
        new RuntimeError("HTTP proxy closed before CONNECT completed.", {
          code: "ERR_RSTREAM_PROXY_CONNECT",
        }),
      );
    const onData = (chunk: Buffer) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      const end = state.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      cleanup();
      resolve({
        header: state.buffer.subarray(0, end).toString("utf8"),
        rest: state.buffer.subarray(end + 4),
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("data", onData);
    socket.once("error", rejectWithCleanup);
    socket.once("close", onClose);
  });
}
