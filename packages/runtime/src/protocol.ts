// See LICENSE file in the project root for license information.

import * as RstreamProto from "../.generated/protobuf/rstream";
import { EngineError } from "./errors";
import { RuntimeError } from "./errors";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { Socket } from "node:net";
import type { ServerDetails } from "./types";
import type { TunnelProperties } from "./types";

export const protocolVersion = "1.4.1";
export const runtimeAgent = "rstream-js-runtime";
export const runtimeChannel = "sdk";
export const maxFrameSize = 65535;

const PB = RstreamProto.rstream.io_rstrm.protobuf;
const GooglePB = RstreamProto.google.protobuf;

export type PBMessage = RstreamProto.rstream.io_rstrm.protobuf.IMessage;
export type PBError = RstreamProto.rstream.io_rstrm.protobuf.IError;
export type PBTunnelProperties =
  RstreamProto.rstream.io_rstrm.protobuf.ITunnelProperties;
export type PBProxyConnReq =
  RstreamProto.rstream.io_rstrm.protobuf.IProxyConnReq;
export type PBOpenTunnelRsp =
  RstreamProto.rstream.io_rstrm.protobuf.IOpenTunnelRsp;
export type PBServerDetails =
  RstreamProto.rstream.io_rstrm.protobuf.IServerDetails;

type SocketChunk = Buffer | string | Uint8Array;

function stringValue(
  value?: string,
): RstreamProto.google.protobuf.IStringValue | undefined {
  return value === undefined ? undefined : new GooglePB.StringValue({ value });
}

function boolValue(
  value?: boolean,
): RstreamProto.google.protobuf.IBoolValue | undefined {
  return value === undefined ? undefined : new GooglePB.BoolValue({ value });
}

function uint32Value(
  value?: number,
): RstreamProto.google.protobuf.IUInt32Value | undefined {
  return value === undefined ? undefined : new GooglePB.UInt32Value({ value });
}

function timestampValue(
  value?: Date,
): RstreamProto.google.protobuf.ITimestamp | undefined {
  if (value === undefined) return undefined;
  const millis = value.getTime();
  const seconds = Math.floor(millis / 1000);
  const nanos = (millis % 1000) * 1000000;
  return new GooglePB.Timestamp({ nanos, seconds });
}

function wrapperString(
  value?: RstreamProto.google.protobuf.IStringValue | null,
): string | undefined {
  return value?.value ?? undefined;
}

function wrapperBool(
  value?: RstreamProto.google.protobuf.IBoolValue | null,
): boolean | undefined {
  return value?.value ?? undefined;
}

function wrapperNumber(
  value?: RstreamProto.google.protobuf.IUInt32Value | null,
): number | undefined {
  return value?.value ?? undefined;
}

function wrapperDate(
  value?: RstreamProto.google.protobuf.ITimestamp | null,
): Date | undefined {
  if (value?.seconds === undefined) return undefined;
  const seconds = Number(value.seconds);
  const nanos = value.nanos ?? 0;
  return new Date(seconds * 1000 + Math.floor(nanos / 1000000));
}

export function tunnelPropertiesToPB(
  properties: TunnelProperties,
): PBTunnelProperties {
  return new PB.TunnelProperties({
    challengeMode: boolValue(properties.challengeMode),
    creationDate: timestampValue(properties.creationDate),
    geoip: properties.geoIp,
    host: stringValue(properties.host),
    hostname: stringValue(properties.hostname),
    httpUseTls: boolValue(properties.httpUseTls),
    httpVersion: stringValue(properties.httpVersion),
    id: stringValue(properties.id),
    labels: properties.labels,
    mtlsAuth: boolValue(properties.mtlsAuth),
    name: stringValue(properties.name),
    port: uint32Value(properties.port),
    protocol: stringValue(properties.protocol),
    publish: boolValue(properties.publish),
    rstreamAuth: boolValue(properties.rstreamAuth),
    tlsAlpns: properties.tlsAlpns,
    tlsCiphers: properties.tlsCiphers,
    tlsMinVersion: stringValue(properties.tlsMinVersion),
    tlsMode: stringValue(properties.tlsMode),
    tokenAuth: boolValue(properties.tokenAuth),
    trustedIps: properties.trustedIps,
    type: stringValue(properties.type),
    upstreamTls: boolValue(properties.upstreamTls),
  });
}

export function tunnelPropertiesFromPB(
  properties: PBTunnelProperties,
): TunnelProperties {
  return {
    challengeMode: wrapperBool(properties.challengeMode),
    creationDate: wrapperDate(properties.creationDate),
    geoIp: properties.geoip ?? undefined,
    host: wrapperString(properties.host),
    hostname: wrapperString(properties.hostname),
    httpUseTls: wrapperBool(properties.httpUseTls),
    httpVersion: httpVersionFromString(wrapperString(properties.httpVersion)),
    id: wrapperString(properties.id),
    labels: properties.labels ?? undefined,
    mtlsAuth: wrapperBool(properties.mtlsAuth),
    name: wrapperString(properties.name),
    port: wrapperNumber(properties.port),
    protocol: protocolFromString(wrapperString(properties.protocol)),
    publish: wrapperBool(properties.publish),
    rstreamAuth: wrapperBool(properties.rstreamAuth),
    tlsAlpns: properties.tlsAlpns ?? undefined,
    tlsCiphers: properties.tlsCiphers ?? undefined,
    tlsMinVersion: wrapperString(properties.tlsMinVersion),
    tlsMode: tlsModeFromString(wrapperString(properties.tlsMode)),
    tokenAuth: wrapperBool(properties.tokenAuth),
    trustedIps: properties.trustedIps ?? undefined,
    type: tunnelTypeFromString(wrapperString(properties.type)),
    upstreamTls: wrapperBool(properties.upstreamTls),
  };
}

function tunnelTypeFromString(value?: string): TunnelProperties["type"] {
  if (value === "bytestream" || value === "datagram") return value;
  return undefined;
}

function protocolFromString(value?: string): TunnelProperties["protocol"] {
  if (
    value === "tls" ||
    value === "dtls" ||
    value === "quic" ||
    value === "http" ||
    value === "webtty"
  )
    return value;
  return undefined;
}

function tlsModeFromString(value?: string): TunnelProperties["tlsMode"] {
  if (value === "passthrough" || value === "terminated") return value;
  return undefined;
}

function httpVersionFromString(
  value?: string,
): TunnelProperties["httpVersion"] {
  if (
    value === "http/1.1" ||
    value === "h2" ||
    value === "h2c" ||
    value === "h3"
  )
    return value;
  return undefined;
}

export function serverDetailsFromPB(
  details?: PBServerDetails | null,
): ServerDetails | undefined {
  if (details === undefined || details === null) return undefined;
  return {
    agent: wrapperString(details.agent),
    channel: wrapperString(details.channel),
    plan: wrapperString(details.plan),
    provider: wrapperString(details.provider),
    region: wrapperString(details.region),
    update: wrapperString(details.update),
    version: wrapperString(details.version),
  };
}

export function createClientDetails(
  token?: string,
): RstreamProto.rstream.io_rstrm.protobuf.ClientDetails {
  return new PB.ClientDetails({
    agent: stringValue(runtimeAgent),
    arch: stringValue(process.arch),
    channel: stringValue(runtimeChannel),
    os: stringValue(process.platform),
    protocolVersion: stringValue(protocolVersion),
    token: stringValue(token),
    version: stringValue(packageVersion()),
  });
}

export function packageVersion(): string {
  return "0.1.0";
}

export function messageWithOpenControlChannelReq(token?: string): PBMessage {
  return new PB.Message({
    openControlChannelReq: new PB.OpenControlChannelReq({
      clientDetails: createClientDetails(token),
    }),
  });
}

export function messageWithCloseControlChannelReq(): PBMessage {
  return new PB.Message({
    closeControlChannelReq: new PB.CloseControlChannelReq(),
  });
}

export function messageWithOpenTunnelReq(
  requestId: string,
  properties: TunnelProperties,
): PBMessage {
  return new PB.Message({
    openTunnelReq: new PB.OpenTunnelReq({
      requestId,
      tunnelProperties: tunnelPropertiesToPB(properties),
    }),
  });
}

export function messageWithCloseTunnelReq(tunnelId: string): PBMessage {
  return new PB.Message({
    closeTunnelReq: new PB.CloseTunnelReq({ tunnelId }),
  });
}

export function messageWithProxyConnRsp(
  streamId: string,
  error?: PBError,
): PBMessage {
  return new PB.Message({
    proxyConnRsp: new PB.ProxyConnRsp({
      error,
      streamId,
    }),
  });
}

export function messageWithProxyReq(
  streamId: string,
  token: string | undefined,
  zeroRtt: boolean,
): PBMessage {
  return new PB.Message({
    proxyReq: new PB.ProxyReq({
      clientDetails: createClientDetails(token),
      streamId,
      zeroRtt: boolValue(zeroRtt),
    }),
  });
}

export function messageWithStreamReq(
  tunnelIdOrName: string,
  token: string | undefined,
  zeroRtt: boolean,
): PBMessage {
  return new PB.Message({
    streamReq: new PB.StreamReq({
      clientDetails: createClientDetails(token),
      tunnelIdName: tunnelIdOrName,
      zeroRtt: boolValue(zeroRtt),
    }),
  });
}

export function messageWithHeartbeat(): PBMessage {
  return new PB.Message({
    heartbeat: new PB.Heartbeat(),
  });
}

export function engineErrorFromPB(error: PBError): EngineError {
  return new EngineError(
    error.code ?? 0,
    error.message?.value ?? "Engine error.",
  );
}

export function errorToPB(message: string): PBError {
  return new PB.Error({
    code: PB.ErrorCode.ERROR_CODE_INVALID_STREAM,
    message: stringValue(message),
  });
}

export function encodeMessage(message: PBMessage): Buffer {
  const payload = Buffer.from(PB.Message.encode(message).finish());
  if (payload.length > maxFrameSize) {
    throw new RuntimeError(
      `Protocol frame too large: ${payload.length} bytes.`,
      {
        code: "ERR_RSTREAM_FRAME_TOO_LARGE",
      },
    );
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function decodeMessage(payload: Buffer): PBMessage {
  return PB.Message.decode(payload);
}

export function writeMessage(
  socket: Socket,
  message: PBMessage,
): Promise<void> {
  const frame = encodeMessage(message);
  return new Promise<void>((resolve, reject) => {
    socket.write(frame, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export class FramedReader extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private readonly messages: PBMessage[] = [];
  private readonly waiters: Array<{
    resolve: (message: PBMessage) => void;
    reject: (error: Error) => void;
  }> = [];
  private closedError: Error | undefined;
  private readonly onDataBound = (chunk: SocketChunk) => this.onData(chunk);
  private readonly onErrorBound = (error: Error) => this.close(error);
  private readonly onCloseBound = () =>
    this.close(
      new RuntimeError("Socket closed.", { code: "ERR_RSTREAM_SOCKET_CLOSED" }),
    );

  constructor(private readonly socket: Socket) {
    super();
    this.socket.on("data", this.onDataBound);
    this.socket.on("error", this.onErrorBound);
    this.socket.on("close", this.onCloseBound);
    this.socket.on("end", this.onCloseBound);
  }

  public read(): Promise<PBMessage> {
    const message = this.messages.shift();
    if (message !== undefined) return Promise.resolve(message);
    if (this.closedError !== undefined) return Promise.reject(this.closedError);
    return new Promise<PBMessage>((resolve, reject) => {
      this.waiters.push({ reject, resolve });
    });
  }

  public release(): void {
    this.removeListeners();
    if (this.buffer.length > 0) {
      this.socket.unshift(this.buffer);
      this.buffer = Buffer.alloc(0);
    }
  }

  private onData(chunk: SocketChunk): void {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    this.drain();
  }

  private drain(): void {
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > maxFrameSize) {
        this.close(
          new RuntimeError(`Protocol frame too large: ${length} bytes.`, {
            code: "ERR_RSTREAM_FRAME_TOO_LARGE",
          }),
        );
        return;
      }
      if (this.buffer.length < length + 4) return;
      const payload = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      this.push(decodeMessage(payload));
    }
  }

  private push(message: PBMessage): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(message);
      return;
    }
    this.messages.push(message);
  }

  private close(error: Error): void {
    if (this.closedError !== undefined) return;
    this.closedError = error;
    this.removeListeners();
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }

  private removeListeners(): void {
    this.socket.off("data", this.onDataBound);
    this.socket.off("error", this.onErrorBound);
    this.socket.off("close", this.onCloseBound);
    this.socket.off("end", this.onCloseBound);
  }
}
