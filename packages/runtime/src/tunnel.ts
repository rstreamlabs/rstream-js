// See LICENSE file in the project root for license information.

import { isAbortError } from "./errors";
import { RuntimeError } from "./errors";
import { AsyncQueue } from "./queue";
import type { ControlChannel } from "./control-channel";
import type { AcceptOptions } from "./types";
import type { BytestreamTunnel } from "./types";
import type { HTTPServer } from "./types";
import type { ServeHTTPOptions } from "./types";
import type { TunnelProperties } from "./types";
import type { Duplex } from "node:stream";

const defaultPublishedPort = 443;

export class BytestreamTunnelImpl implements BytestreamTunnel {
  private readonly queue = new AsyncQueue<Duplex>();
  private currentProperties: TunnelProperties;
  private closedState = false;

  constructor(
    private readonly control: ControlChannel,
    properties: TunnelProperties,
  ) {
    if (properties.id === undefined) {
      throw new RuntimeError("Engine did not return a tunnel ID.", {
        code: "ERR_RSTREAM_PROTOCOL",
      });
    }
    this.currentProperties = properties;
  }

  public get id(): string {
    return this.currentProperties.id ?? "";
  }

  public get closed(): boolean {
    return this.closedState;
  }

  public properties(): TunnelProperties {
    return { ...this.currentProperties };
  }

  public async forwardingAddress(): Promise<string> {
    return formatForwardingAddress(this.currentProperties);
  }

  public async accept(options?: AcceptOptions): Promise<Duplex> {
    return await this.queue.shift(options?.signal);
  }

  public async close(): Promise<void> {
    if (this.closedState) return;
    await this.control.closeTunnel(this.id);
  }

  public async serve(
    server: HTTPServer,
    options?: ServeHTTPOptions,
  ): Promise<void> {
    await this.serveHttp(server, options);
  }

  public async serveHttp(
    server: HTTPServer,
    options?: ServeHTTPOptions,
  ): Promise<void> {
    while (!this.closedState) {
      try {
        const socket = await this.accept({ signal: options?.signal });
        server.emit("connection", socket);
      } catch (error) {
        if (isAbortError(error) || this.closedState) return;
        throw error;
      }
    }
  }

  public async *[Symbol.asyncIterator](): AsyncIterableIterator<Duplex> {
    while (!this.closedState) {
      try {
        yield await this.accept();
      } catch (error) {
        if (this.closedState) return;
        throw error;
      }
    }
  }

  public deliver(socket: Duplex): boolean {
    if (this.closedState) {
      socket.destroy();
      return false;
    }
    const delivered = this.queue.push(socket);
    if (!delivered) socket.destroy();
    return delivered;
  }

  public onClose(error?: Error): void {
    if (this.closedState) return;
    this.closedState = true;
    this.queue.close(
      error ??
        new RuntimeError("Tunnel closed.", {
          code: "ERR_RSTREAM_TUNNEL_CLOSED",
        }),
    );
  }
}

export function formatForwardingAddress(properties: TunnelProperties): string {
  const published = publishedHost(properties);
  if (published !== undefined) {
    if (properties.protocol === "http") return `https://${published}`;
    if (properties.protocol === "tls") return `${published} (tls)`;
    if (properties.protocol === "tcp") return `${published} (tcp)`;
    if (properties.protocol === "dtls") return `${published} (dtls)`;
    if (properties.protocol === "quic") return `${published} (quic)`;
    if (properties.protocol === "webtty")
      return `https://${published} (webtty)`;
    return published;
  }
  if (properties.name !== undefined)
    return `rstrm://${properties.name} (unpublished)`;
  if (properties.id !== undefined)
    return `rstrm://${properties.id} (unpublished)`;
  throw new RuntimeError("Invalid tunnel properties: no host, name, or ID.", {
    code: "ERR_RSTREAM_INVALID_TUNNEL",
  });
}

function publishedHost(properties: TunnelProperties): string | undefined {
  if (properties.hostname !== undefined && properties.hostname.trim() !== "") {
    const port = properties.port ?? defaultPublishedPort;
    if (
      properties.protocol === "tls" ||
      properties.protocol === "tcp" ||
      port !== defaultPublishedPort
    ) {
      return `${properties.hostname}:${port}`;
    }
    return properties.hostname;
  }
  if (properties.host !== undefined && properties.host.trim() !== "") {
    return properties.host;
  }
  return undefined;
}
