// See LICENSE file in the project root for license information.

import { Buffer } from "node:buffer";
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
  proxy?: {
    headers?: Record<string, string>;
    url: string;
    username?: string;
    password?: string;
  };
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
    const socket =
      this.options.proxy === undefined
        ? await this.dialDirect(target, options.signal)
        : await this.dialProxy(target, this.options.proxy, options.signal);
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
    proxy: NonNullable<NodeTransportOptions["proxy"]>,
    signal?: AbortSignal,
  ): Promise<net.Socket> {
    const proxyUrl = new URL(proxy.url);
    const proxyTarget = parseHostPort(
      proxyUrl.host,
      proxyUrl.protocol === "https:" ? 443 : 80,
    );
    const raw = await connectTcp({
      family: this.options.family,
      host: proxyTarget.host,
      localAddress: this.options.localAddress,
      port: proxyTarget.port,
      signal,
    });
    const socket =
      proxyUrl.protocol === "https:"
        ? await startProxyTls(raw, proxyTarget, signal)
        : raw;
    await writeConnectRequest(socket, target, proxy, signal);
    return socket;
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
  if (config.useQuic === true) {
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
  const proxy =
    config.proxy?.http === undefined
      ? undefined
      : {
          headers: config.proxy.headers,
          password: config.proxy.password,
          url: config.proxy.http,
          username: config.proxy.username,
        };
  return new NodeTransport({ family, localAddress, proxy });
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

function connectTcp(
  options: net.NetConnectOpts & { signal?: AbortSignal },
): Promise<net.Socket> {
  if (options.signal?.aborted) {
    return Promise.reject(
      new RuntimeError("TCP dial aborted.", {
        code: "ERR_RSTREAM_DIAL_ABORTED",
      }),
    );
  }
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(options);
    const onAbort = () =>
      socket.destroy(
        new RuntimeError("TCP dial aborted.", {
          code: "ERR_RSTREAM_DIAL_ABORTED",
        }),
      );
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
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
    options.signal?.addEventListener("abort", onAbort, { once: true });
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
    const onAbort = () =>
      socket.destroy(
        new RuntimeError("TLS dial aborted.", {
          code: "ERR_RSTREAM_DIAL_ABORTED",
        }),
      );
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
  signal?: AbortSignal,
): Promise<TLSSocket> {
  return await connectTls(
    {
      servername: proxy.host,
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
    const onAbort = () =>
      rejectWithCleanup(
        new RuntimeError("HTTP proxy CONNECT aborted.", {
          code: "ERR_RSTREAM_DIAL_ABORTED",
        }),
      );
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
