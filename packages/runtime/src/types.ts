// See LICENSE file in the project root for license information.

import type http from "node:http";
import type http2 from "node:http2";
import type { Duplex } from "node:stream";

export type TunnelType = "bytestream" | "datagram";
export type TunnelProtocol =
  | "tls"
  | "tcp"
  | "dtls"
  | "quic"
  | "http"
  | "webtty";
export type TLSMode = "passthrough" | "terminated";
export type HTTPVersion = "http/1.1" | "h2" | "h2c" | "h3";

export interface TunnelAuthOptions {
  token?: boolean;
  rstream?: boolean;
  challenge?: boolean;
}

export interface TunnelProperties {
  allowCrossRegionRouting?: boolean;
  id?: string;
  creationDate?: Date;
  name?: string;
  type?: TunnelType;
  publish?: boolean;
  protocol?: TunnelProtocol;
  labels?: Record<string, string>;
  geoIp?: string[];
  trustedIps?: string[];
  host?: string;
  hostname?: string;
  port?: number;
  tlsMode?: TLSMode;
  tlsAlpns?: string[];
  tlsMinVersion?: string;
  tlsCiphers?: string[];
  mtlsAuth?: boolean;
  httpVersion?: HTTPVersion;
  httpUseTls?: boolean;
  upstreamTls?: boolean;
  datagramGuaranteedDelivery?: boolean;
  tokenAuth?: boolean;
  rstreamAuth?: boolean;
  challengeMode?: boolean;
}

export interface CreateTunnelOptions extends Omit<
  TunnelProperties,
  "creationDate" | "datagramGuaranteedDelivery" | "host" | "id"
> {
  auth?: TunnelAuthOptions;
}

export interface CreateBytestreamTunnelOptions extends Omit<
  CreateTunnelOptions,
  "type"
> {
  type?: "bytestream";
}

export interface DialOptions {
  signal?: AbortSignal;
  token?: string;
  zeroRtt?: boolean;
}

export interface AcceptOptions {
  signal?: AbortSignal;
}

export interface ServeHTTPOptions {
  signal?: AbortSignal;
}

export type HTTPServer = http.Server | http2.Http2Server;

export interface Tunnel {
  readonly id: string;
  readonly closed: boolean;
  properties(): TunnelProperties;
  forwardingAddress(): Promise<string>;
  close(): Promise<void>;
}

export interface BytestreamTunnel extends Tunnel {
  accept(options?: AcceptOptions): Promise<Duplex>;
  serve(server: HTTPServer, options?: ServeHTTPOptions): Promise<void>;
  serveHttp(server: HTTPServer, options?: ServeHTTPOptions): Promise<void>;
  [Symbol.asyncIterator](): AsyncIterableIterator<Duplex>;
}

export interface ServerDetails {
  agent?: string;
  channel?: string;
  version?: string;
  plan?: string;
  provider?: string;
  region?: string;
  update?: string;
}
