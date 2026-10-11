// See LICENSE file in the project root for license information.

import { normalizeEngineAddress } from "./resolution";
import { readBoundedText } from "./http-lifetime";
import { requestLifetime } from "./http-lifetime";
import { RstreamHTTPError } from "@rstreamlabs/rstream";
import { waitWithSignal } from "./http-lifetime";
import { z } from "zod";
import type { EngineTLSOptions } from "./node-engine-http";
import type { NodeEngineHTTP } from "./node-engine-http";

type Discovery = { source: string; url: string; expiresAt: number };
const discoverySchema = z.object({
  version: z.literal(1),
  projectEndpoint: z.string(),
  mtlsApiUrl: z.string(),
  capabilities: z.array(z.string()).max(32),
});

export const hasClientCertificate = (tls?: EngineTLSOptions): boolean =>
  tls?.cert !== undefined || tls?.key !== undefined;

const validateMTLSURL = (target: string, source: URL): string => {
  const url = new URL(target);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api" ||
    url.hostname.split(".")[0] !== source.hostname.split(".")[0]
  )
    throw new Error("Invalid discovered mTLS Engine API URL.");
  normalizeEngineAddress(url.host);
  return url.href;
};

const discoveryCacheMilliseconds = (response: Response): number => {
  const cache = response.headers.get("cache-control") ?? "";
  if (/\bno-(?:store|cache)\b/i.test(cache)) return 0;
  const seconds = cache.match(/\bmax-age\s*=\s*"?(\d+)/i)?.[1];
  return Math.min(seconds === undefined ? 3600 : Number(seconds), 86400) * 1000;
};

export class EngineHTTP {
  private readonly closed = new AbortController();
  private authenticated?: Promise<NodeEngineHTTP>;
  private anonymous?: Promise<NodeEngineHTTP>;
  private discovery?: Discovery;
  private flight?: { source: string; promise: Promise<Discovery> };
  constructor(
    private readonly options: {
      tls?: EngineTLSOptions;
      mtlsApiUrl?: string;
      fetch?: typeof globalThis.fetch;
    },
  ) {
    if (
      hasClientCertificate(options.tls) &&
      (!options.tls?.cert || !options.tls?.key)
    )
      throw new Error("mTLS requires both a certificate and its private key.");
  }
  get usesMTLS(): boolean {
    return hasClientCertificate(this.options.tls);
  }
  async close(): Promise<void> {
    this.closed.abort(new Error("Engine HTTP client is closed."));
    this.discovery = undefined;
    await Promise.all([
      this.authenticated?.then((client) => client.close()),
      this.anonymous?.then((client) => client.close()),
    ]);
  }
  private async transport(
    anonymous: boolean,
  ): Promise<typeof globalThis.fetch> {
    this.closed.signal.throwIfAborted();
    if (!anonymous && this.options.fetch) return this.options.fetch;
    if (!this.options.tls) return globalThis.fetch;
    if (anonymous) {
      this.anonymous ??= import("./node-engine-http").then(
        ({ NodeEngineHTTP }) =>
          new NodeEngineHTTP({
            ca: this.options.tls?.ca,
            rejectUnauthorized: true,
          }),
      );
      return (await this.anonymous).fetch;
    }
    this.authenticated ??= import("./node-engine-http").then(
      ({ NodeEngineHTTP }) => new NodeEngineHTTP(this.options.tls ?? {}),
    );
    return (await this.authenticated).fetch;
  }
  async apiURL(engine: string, signal?: AbortSignal | null): Promise<string> {
    this.closed.signal.throwIfAborted();
    signal?.throwIfAborted();
    const source = new URL(`https://${normalizeEngineAddress(engine)}`);
    if (!this.usesMTLS) return `https://${normalizeEngineAddress(engine)}/api`;
    if (this.options.mtlsApiUrl)
      return validateMTLSURL(this.options.mtlsApiUrl, source);
    if (
      this.discovery?.source === source.origin &&
      this.discovery.expiresAt > Date.now()
    )
      return this.discovery.url;
    const flight =
      this.flight?.source === source.origin
        ? this.flight
        : { source: source.origin, promise: this.discover(source) };
    this.flight = flight;
    try {
      const discovery = await waitWithSignal(flight.promise, signal);
      this.discovery = discovery;
      return discovery.url;
    } finally {
      void flight.promise.then(
        () => {
          if (this.flight === flight) this.flight = undefined;
        },
        () => {
          if (this.flight === flight) this.flight = undefined;
        },
      );
    }
  }
  private async discover(source: URL): Promise<Discovery> {
    const lifetime = requestLifetime([this.closed.signal], 5000);
    try {
      const fetch = await this.transport(true);
      const response = await fetch(
        new URL("/.well-known/rstream/engine", source),
        {
          method: "GET",
          credentials: "omit",
          redirect: "manual",
          signal: lifetime.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new RstreamHTTPError(
          response.status,
          "mTLS Engine discovery failed.",
        );
      }
      const text = await readBoundedText(response, 16384);
      const value: unknown = JSON.parse(text);
      const document = discoverySchema.parse(value);
      if (
        document.projectEndpoint !== source.hostname.split(".")[0] ||
        !document.capabilities.includes("engine-api-mtls")
      )
        throw new Error(
          "Engine discovery does not advertise mTLS for this project.",
        );
      return {
        source: source.origin,
        url: validateMTLSURL(document.mtlsApiUrl, source),
        expiresAt: Date.now() + discoveryCacheMilliseconds(response),
      };
    } finally {
      lifetime.close();
    }
  }
  async eventStream(
    engine: string,
    options: RequestInit,
  ): Promise<{ response: Response; close(): void }> {
    const lifetime = requestLifetime(
      [this.closed.signal, options.signal],
      10000,
    );
    try {
      const base = await this.apiURL(engine, lifetime.signal);
      const headers = new Headers(options.headers);
      if (this.usesMTLS && headers.has("authorization"))
        throw new Error("Use a token or mTLS, not both.");
      headers.set("Accept", "text/event-stream");
      const fetch = await this.transport(false);
      const response = await fetch(`${base}/sse`, {
        method: "GET",
        headers,
        credentials: "omit",
        redirect: "manual",
        signal: lifetime.signal,
      });
      if (!response.ok)
        throw new RstreamHTTPError(
          response.status,
          await readBoundedText(response, 16384),
        );
      if (
        !response.headers.get("content-type")?.startsWith("text/event-stream")
      )
        throw new Error("Engine returned an invalid event stream.");
      lifetime.stopTimer();
      return {
        response,
        close: () => {
          lifetime.abort();
          lifetime.close();
        },
      };
    } catch (error) {
      lifetime.abort();
      lifetime.close();
      if (!(error instanceof RstreamHTTPError)) this.discovery = undefined;
      throw error;
    }
  }
  async response(
    engine: string,
    path: string,
    options: RequestInit = {},
    maxBytes = 16 * 1024 * 1024,
  ): Promise<Response> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
      throw new Error("Engine request path must be a relative absolute path.");
    const lifetime = requestLifetime(
      [this.closed.signal, options.signal],
      10000,
    );
    try {
      const base = await this.apiURL(engine, lifetime.signal);
      const url = new URL(`${base}${path}`);
      if (
        url.origin !== new URL(base).origin ||
        !url.pathname.startsWith("/api/") ||
        url.username ||
        url.password
      )
        throw new Error(
          "Engine request path must remain inside the Engine API.",
        );
      const headers = new Headers(options.headers);
      if (
        this.usesMTLS &&
        (headers.has("authorization") || url.searchParams.has("rstream.token"))
      )
        throw new Error("Use a token or mTLS, not both.");
      const fetch = await this.transport(false);
      const response = await fetch(`${base}${path}`, {
        ...options,
        headers,
        credentials: "omit",
        redirect: "manual",
        signal: lifetime.signal,
      });
      const text = await readBoundedText(
        response,
        response.ok ? maxBytes : 16384,
      );
      if (!response.ok) throw new RstreamHTTPError(response.status, text);
      return new Response([204, 205].includes(response.status) ? null : text, {
        status: response.status,
        headers: response.headers,
      });
    } catch (error) {
      if (!(error instanceof RstreamHTTPError)) this.discovery = undefined;
      throw error;
    } finally {
      lifetime.close();
    }
  }
}
