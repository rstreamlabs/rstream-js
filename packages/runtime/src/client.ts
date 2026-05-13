// See LICENSE file in the project root for license information.

import { ControlChannel } from "./control-channel";
import { engineErrorFromPB } from "./protocol";
import { FramedReader } from "./protocol";
import { messageWithOpenControlChannelReq } from "./protocol";
import { messageWithProxyReq } from "./protocol";
import { messageWithStreamReq } from "./protocol";
import { NodeTransport } from "./transport";
import { resolveClientOptions } from "./config";
import { resolveLogger } from "./logger";
import { RstreamTunnelsClient } from "@rstreamlabs/tunnels";
import { RuntimeError } from "./errors";
import { serverDetailsFromPB } from "./protocol";
import { writeMessage } from "./protocol";
import type { ClientOptions } from "./config";
import type { DialOptions } from "./types";
import type { Duplex } from "node:stream";
import type { Logger } from "./logger";
import type { PBProxyConnReq } from "./protocol";
import type { ResolvedClientOptions } from "./config";
import type { TLSSocket } from "node:tls";

export interface DialTarget {
  tunnel: string;
}

export class Client {
  private resolved: Promise<ResolvedClientOptions> | undefined;
  private readonly logger: Required<Logger>;

  constructor(private readonly options?: ClientOptions) {
    this.logger = resolveLogger(options?.logger);
  }

  public static fromEnv(options?: ClientOptions): Client {
    return new Client(options);
  }

  public async connect(options?: {
    signal?: AbortSignal;
  }): Promise<ControlChannel> {
    const resolved = await this.getResolved();
    const engine = await this.resolveEngine(resolved);
    const token = await this.resolveToken(resolved, engine);
    const socket = await this.dialEngine(engine, resolved, options?.signal);
    const reader = new FramedReader(socket);
    try {
      await writeMessage(socket, messageWithOpenControlChannelReq(token));
      const response = await reader.read();
      if (
        response.openControlChannelRsp === undefined ||
        response.openControlChannelRsp === null
      ) {
        throw new RuntimeError("Engine did not return OpenControlChannelRsp.", {
          code: "ERR_RSTREAM_PROTOCOL",
        });
      }
      const payload = response.openControlChannelRsp;
      if (payload.error !== undefined && payload.error !== null)
        throw engineErrorFromPB(payload.error);
      if (payload.ok === undefined || payload.ok === null) {
        throw new RuntimeError(
          "Engine returned an empty OpenControlChannelRsp.",
          {
            code: "ERR_RSTREAM_PROTOCOL",
          },
        );
      }
      reader.release();
      this.logger.info("control channel connected", {
        clientId: payload.ok.clientId,
        engine,
      });
      return new ControlChannel(socket, {
        heartbeat: resolved.heartbeat,
        heartbeatIntervalMs: resolved.heartbeatIntervalMs,
        logger: this.logger,
        openProxyConnection: async (req) =>
          await this.openProxyConnection(engine, resolved, req),
        serverDetails: serverDetailsFromPB(payload.ok.serverDetails),
      });
    } catch (error) {
      reader.release();
      socket.destroy();
      throw error;
    }
  }

  public async dial(
    target: string | DialTarget,
    options?: DialOptions,
  ): Promise<Duplex> {
    const tunnel = typeof target === "string" ? target : target.tunnel;
    const normalized = tunnel.trim();
    if (!normalized) {
      throw new RuntimeError("Tunnel ID or name is required.", {
        code: "ERR_RSTREAM_INVALID_TUNNEL",
      });
    }
    const resolved = await this.getResolved();
    const engine = await this.resolveEngine(resolved);
    const token = options?.token ?? (await this.resolveToken(resolved, engine));
    const socket = await this.dialEngine(engine, resolved, options?.signal);
    const zeroRtt = options?.zeroRtt ?? resolved.zeroRtt;
    const reader = zeroRtt ? undefined : new FramedReader(socket);
    try {
      await writeMessage(
        socket,
        messageWithStreamReq(normalized, token, zeroRtt),
      );
      if (reader !== undefined) {
        const response = await reader.read();
        if (response.streamRsp === undefined || response.streamRsp === null) {
          throw new RuntimeError("Engine did not return StreamRsp.", {
            code: "ERR_RSTREAM_PROTOCOL",
          });
        }
        if (
          response.streamRsp.error !== undefined &&
          response.streamRsp.error !== null
        ) {
          throw engineErrorFromPB(response.streamRsp.error);
        }
        reader.release();
      }
      return socket;
    } catch (error) {
      reader?.release();
      socket.destroy();
      throw error;
    }
  }

  public async dialBytestream(
    target: string | DialTarget,
    options?: DialOptions,
  ): Promise<Duplex> {
    return await this.dial(target, options);
  }

  private async openProxyConnection(
    engine: string,
    resolved: ResolvedClientOptions,
    req: PBProxyConnReq,
  ): Promise<Duplex> {
    const socket = await this.dialEngine(engine, resolved);
    const zeroRtt = resolved.zeroRtt;
    const token = req.secret?.value;
    const reader = zeroRtt ? undefined : new FramedReader(socket);
    try {
      await writeMessage(
        socket,
        messageWithProxyReq(req.streamId ?? "", token ?? undefined, zeroRtt),
      );
      if (reader !== undefined) {
        const response = await reader.read();
        if (response.proxyRsp === undefined || response.proxyRsp === null) {
          throw new RuntimeError("Engine did not return ProxyRsp.", {
            code: "ERR_RSTREAM_PROTOCOL",
          });
        }
        if (
          response.proxyRsp.error !== undefined &&
          response.proxyRsp.error !== null
        ) {
          throw engineErrorFromPB(response.proxyRsp.error);
        }
        reader.release();
      }
      return socket;
    } catch (error) {
      reader?.release();
      socket.destroy();
      throw error;
    }
  }

  private async dialEngine(
    engine: string,
    resolved: ResolvedClientOptions,
    signal?: AbortSignal,
  ): Promise<TLSSocket> {
    const transport = resolved.transport ?? new NodeTransport();
    return await transport.dial({
      address: engine,
      alpnProtocols: ["rstrm/1"],
      signal,
      tls: resolved.tls,
    });
  }

  private async resolveEngine(
    resolved: ResolvedClientOptions,
  ): Promise<string> {
    if (resolved.engine !== undefined) return resolved.engine;
    if (resolved.projectEndpoint === undefined) {
      throw new RuntimeError("Engine is required but not configured.", {
        code: "ERR_RSTREAM_ENGINE_REQUIRED",
      });
    }
    return await this.engineClient(resolved).getEngine();
  }

  private async resolveToken(
    resolved: ResolvedClientOptions,
    engine: string,
  ): Promise<string | undefined> {
    if (resolved.noToken) return undefined;
    if (
      resolved.credentials !== undefined &&
      "clientId" in resolved.credentials
    ) {
      return await this.engineClient(resolved).getToken(engine);
    }
    if (resolved.token !== undefined) return resolved.token;
    if (resolved.credentials !== undefined && "token" in resolved.credentials)
      return resolved.credentials.token;
    return undefined;
  }

  private engineClient(resolved: ResolvedClientOptions): RstreamTunnelsClient {
    return new RstreamTunnelsClient({
      apiUrl: resolved.apiUrl,
      credentials:
        resolved.credentials ??
        (resolved.token === undefined ? undefined : { token: resolved.token }),
      engine: resolved.engine,
      projectEndpoint: resolved.projectEndpoint,
    });
  }

  private async getResolved(): Promise<ResolvedClientOptions> {
    if (this.resolved === undefined) {
      this.resolved = resolveClientOptions(this.options ?? {});
    }
    return await this.resolved;
  }
}
