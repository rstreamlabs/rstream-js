// See LICENSE file in the project root for license information.

import { BytestreamTunnelImpl } from "./tunnel";
import { engineErrorFromPB } from "./protocol";
import { errorToPB } from "./protocol";
import { FramedReader } from "./protocol";
import { messageWithCloseControlChannelReq } from "./protocol";
import { messageWithCloseTunnelReq } from "./protocol";
import { messageWithHeartbeat } from "./protocol";
import { messageWithOpenTunnelReq } from "./protocol";
import { messageWithProxyConnRsp } from "./protocol";
import { randomUUID } from "node:crypto";
import { RuntimeError } from "./errors";
import { tunnelPropertiesFromPB } from "./protocol";
import { writeMessage } from "./protocol";
import type { BytestreamTunnel } from "./types";
import type { CreateBytestreamTunnelOptions } from "./types";
import type { CreateTunnelOptions } from "./types";
import type { Duplex } from "node:stream";
import type { Logger } from "./logger";
import type { PBMessage } from "./protocol";
import type { PBOpenTunnelRsp } from "./protocol";
import type { PBProxyConnReq } from "./protocol";
import type { ServerDetails } from "./types";
import type { TLSSocket } from "node:tls";
import type { TunnelProperties } from "./types";

interface PendingTunnel {
  reject: (error: Error) => void;
  resolve: (tunnel: BytestreamTunnel) => void;
}

interface PendingClose {
  reject: (error: Error) => void;
  resolve: () => void;
}

export interface ControlChannelOptions {
  heartbeat: boolean;
  heartbeatIntervalMs: number;
  logger: Required<Logger>;
  openProxyConnection: (req: PBProxyConnReq) => Promise<Duplex>;
  serverDetails?: ServerDetails;
}

export class ControlChannel {
  private readonly reader: FramedReader;
  private readonly pendingTunnels = new Map<string, PendingTunnel>();
  private readonly pendingCloses = new Map<string, PendingClose>();
  private readonly tunnels = new Map<string, BytestreamTunnelImpl>();
  private readonly donePromise: Promise<void>;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private writeChain = Promise.resolve();
  private closing = false;
  private closed = false;
  private closeError: Error | undefined;
  private doneResolve: () => void = () => undefined;

  constructor(
    private readonly socket: TLSSocket,
    private readonly options: ControlChannelOptions,
  ) {
    this.reader = new FramedReader(socket);
    this.donePromise = new Promise<void>((resolve) => {
      this.doneResolve = resolve;
    });
    this.start();
  }

  public serverDetails(): ServerDetails | undefined {
    return this.options.serverDetails === undefined
      ? undefined
      : { ...this.options.serverDetails };
  }

  public done(): Promise<void> {
    return this.donePromise;
  }

  public async createTunnel(
    options: CreateTunnelOptions,
  ): Promise<BytestreamTunnel> {
    if (options.type !== undefined && options.type !== "bytestream") {
      throw new RuntimeError(
        "Only bytestream tunnels are supported by @rstreamlabs/runtime.",
        {
          code: "ERR_RSTREAM_UNSUPPORTED_TUNNEL",
        },
      );
    }
    return await this.createBytestreamTunnel({
      ...options,
      type: "bytestream",
    });
  }

  public async createBytestreamTunnel(
    options: CreateBytestreamTunnelOptions,
  ): Promise<BytestreamTunnel> {
    if (this.closed || this.closing) {
      throw new RuntimeError("Control channel is closed.", {
        code: "ERR_RSTREAM_CONTROL_CLOSED",
      });
    }
    const properties = normalizeBytestreamOptions(options);
    const requestId = randomUUID();
    const promise = new Promise<BytestreamTunnel>((resolve, reject) => {
      this.pendingTunnels.set(requestId, { reject, resolve });
    });
    await this.write(messageWithOpenTunnelReq(requestId, properties));
    return await promise;
  }

  public async closeTunnel(tunnelId: string): Promise<void> {
    const tunnel = this.tunnels.get(tunnelId);
    if (tunnel === undefined || tunnel.closed) return;
    const promise = new Promise<void>((resolve, reject) => {
      this.pendingCloses.set(tunnelId, { reject, resolve });
    });
    await this.write(messageWithCloseTunnelReq(tunnelId));
    await promise;
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    if (!this.closing) {
      this.closing = true;
      await this.write(messageWithCloseControlChannelReq());
    }
    await this.donePromise;
  }

  private start(): void {
    void this.readLoop();
    if (this.options.heartbeat && this.options.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        void this.write(messageWithHeartbeat()).catch((error: unknown) => {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        });
      }, this.options.heartbeatIntervalMs);
      this.heartbeatTimer.unref?.();
    }
  }

  private async readLoop(): Promise<void> {
    try {
      while (!this.closed) {
        await this.handleMessage(await this.reader.read());
      }
    } catch (error) {
      if (!this.closed)
        this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async handleMessage(message: PBMessage): Promise<void> {
    if (message.openTunnelRsp !== undefined && message.openTunnelRsp !== null) {
      this.handleOpenTunnelRsp(message.openTunnelRsp);
      return;
    }
    if (
      message.closeTunnelRsp !== undefined &&
      message.closeTunnelRsp !== null
    ) {
      this.handleCloseTunnelRsp(message.closeTunnelRsp.tunnelId ?? "");
      return;
    }
    if (message.proxyConnReq !== undefined && message.proxyConnReq !== null) {
      await this.handleProxyConnReq(message.proxyConnReq);
      return;
    }
    if (
      message.closeControlChannelRsp !== undefined &&
      message.closeControlChannelRsp !== null
    ) {
      this.finish();
      return;
    }
    if (message.serverMessage !== undefined && message.serverMessage !== null) {
      this.options.logger.info("engine message", {
        message: message.serverMessage.message,
      });
    }
  }

  private handleOpenTunnelRsp(response: PBOpenTunnelRsp): void {
    const requestId = response.requestId ?? "";
    const pending = this.pendingTunnels.get(requestId);
    if (pending === undefined) {
      this.options.logger.warn("unexpected OpenTunnelRsp", { requestId });
      return;
    }
    this.pendingTunnels.delete(requestId);
    if (response.error !== undefined && response.error !== null) {
      pending.reject(engineErrorFromPB(response.error));
      return;
    }
    if (
      response.tunnelProperties === undefined ||
      response.tunnelProperties === null
    ) {
      pending.reject(
        new RuntimeError("Engine returned an empty OpenTunnelRsp.", {
          code: "ERR_RSTREAM_PROTOCOL",
        }),
      );
      return;
    }
    const properties = tunnelPropertiesFromPB(response.tunnelProperties);
    const tunnel = new BytestreamTunnelImpl(this, properties);
    this.tunnels.set(tunnel.id, tunnel);
    pending.resolve(tunnel);
  }

  private handleCloseTunnelRsp(tunnelId: string): void {
    const tunnel = this.tunnels.get(tunnelId);
    this.tunnels.delete(tunnelId);
    tunnel?.onClose();
    const pending = this.pendingCloses.get(tunnelId);
    this.pendingCloses.delete(tunnelId);
    pending?.resolve();
  }

  private async handleProxyConnReq(req: PBProxyConnReq): Promise<void> {
    const tunnelId = req.tunnelId ?? "";
    const streamId = req.streamId ?? "";
    const tunnel = this.tunnels.get(tunnelId);
    if (tunnel === undefined) {
      this.options.logger.warn("unexpected ProxyConnReq", {
        streamId,
        tunnelId,
      });
      await this.write(
        messageWithProxyConnRsp(
          streamId,
          errorToPB("Tunnel is not open on this client."),
        ),
      );
      return;
    }
    try {
      const socket = await this.options.openProxyConnection(req);
      if (!tunnel.deliver(socket)) {
        await this.write(
          messageWithProxyConnRsp(streamId, errorToPB("Tunnel is closed.")),
        );
        return;
      }
      await this.write(messageWithProxyConnRsp(streamId));
    } catch (error) {
      this.options.logger.error("failed to open proxy connection", {
        error,
        streamId,
        tunnelId,
      });
      await this.write(
        messageWithProxyConnRsp(
          streamId,
          errorToPB(error instanceof Error ? error.message : String(error)),
        ),
      );
    }
  }

  private async write(message: PBMessage): Promise<void> {
    this.writeChain = this.writeChain.then(
      () => writeMessage(this.socket, message),
      () => writeMessage(this.socket, message),
    );
    await this.writeChain;
  }

  private fail(error: Error): void {
    this.closeError = error;
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.reader.release();
    this.socket.destroy();
    const error =
      this.closeError ??
      new RuntimeError("Control channel closed.", {
        code: "ERR_RSTREAM_CONTROL_CLOSED",
      });
    for (const pending of this.pendingTunnels.values()) pending.reject(error);
    for (const pending of this.pendingCloses.values()) pending.reject(error);
    for (const tunnel of this.tunnels.values()) tunnel.onClose(error);
    this.pendingTunnels.clear();
    this.pendingCloses.clear();
    this.tunnels.clear();
    this.doneResolve();
  }
}

function normalizeBytestreamOptions(
  options: CreateBytestreamTunnelOptions,
): TunnelProperties {
  if (options.httpVersion === "h3") {
    throw new RuntimeError(
      "HTTP/3 tunnels require datagram support, which @rstreamlabs/runtime does not support.",
      {
        code: "ERR_RSTREAM_UNSUPPORTED_TUNNEL",
      },
    );
  }
  if (options.port !== undefined && options.protocol !== "tcp") {
    throw new RuntimeError("A published port requires protocol tcp.", {
      code: "ERR_RSTREAM_INVALID_TUNNEL",
    });
  }
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535)
  ) {
    throw new RuntimeError(
      "The published TCP port must be between 1 and 65535.",
      { code: "ERR_RSTREAM_INVALID_TUNNEL" },
    );
  }
  if (options.protocol === "tcp" && options.publish === false) {
    throw new RuntimeError("TCP tunnels must be published.", {
      code: "ERR_RSTREAM_INVALID_TUNNEL",
    });
  }
  if (
    options.protocol === "tcp" &&
    (options.hostname !== undefined ||
      options.tlsMode !== undefined ||
      (options.tlsAlpns?.length ?? 0) > 0 ||
      options.tlsMinVersion !== undefined ||
      (options.tlsCiphers?.length ?? 0) > 0 ||
      options.mtlsAuth !== undefined ||
      options.httpVersion !== undefined ||
      options.httpUseTls !== undefined ||
      options.upstreamTls !== undefined ||
      options.tokenAuth !== undefined ||
      options.rstreamAuth !== undefined ||
      options.challengeMode !== undefined ||
      options.auth !== undefined)
  ) {
    throw new RuntimeError(
      "TCP tunnels do not accept hostname, HTTP, TLS, or edge authentication options.",
      { code: "ERR_RSTREAM_INVALID_TUNNEL" },
    );
  }
  return {
    ...options,
    challengeMode: options.challengeMode ?? options.auth?.challenge,
    rstreamAuth: options.rstreamAuth ?? options.auth?.rstream,
    publish: options.protocol === "tcp" ? true : options.publish,
    tokenAuth: options.tokenAuth ?? options.auth?.token,
    type: "bytestream",
  };
}
