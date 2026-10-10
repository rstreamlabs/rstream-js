// See LICENSE file in the project root for license information.

import { Agent } from "node:https";
import { request } from "node:https";
import type { ConnectionOptions } from "node:tls";
import type { IncomingMessage } from "node:http";

export type EngineTLSOptions = Pick<
  ConnectionOptions,
  | "ca"
  | "cert"
  | "key"
  | "checkServerIdentity"
  | "rejectUnauthorized"
  | "servername"
>;

const responseHeaders = (response: IncomingMessage): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
};

const responseBody = (
  response: IncomingMessage,
): ReadableStream<Uint8Array> => {
  const state = { ended: false };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      response.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
        response.pause();
      });
      response.once("end", () => {
        if (!state.ended) {
          state.ended = true;
          controller.close();
        }
      });
      response.once("error", (error: Error) => {
        if (!state.ended) {
          state.ended = true;
          controller.error(error);
        }
      });
      response.once("aborted", () => {
        if (!state.ended) {
          state.ended = true;
          controller.error(new Error("Engine response was interrupted."));
        }
      });
    },
    pull() {
      response.resume();
    },
    cancel() {
      state.ended = true;
      response.destroy();
    },
  });
};

export class NodeEngineHTTP {
  private readonly agent = new Agent({
    keepAlive: true,
    maxSockets: 16,
    maxFreeSockets: 4,
    maxTotalSockets: 16,
  });
  constructor(private readonly tls: EngineTLSOptions) {}
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const incoming = new Request(input, init);
    const url = new URL(incoming.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(
        "Engine HTTP requests require HTTPS without URL credentials.",
      );
    const body = incoming.body
      ? new Uint8Array(await incoming.arrayBuffer())
      : undefined;
    incoming.signal.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          ...this.tls,
          servername: url.hostname,
          agent: this.agent,
          method: incoming.method,
          headers: Object.fromEntries(incoming.headers),
          signal: incoming.signal,
        },
        (response) => {
          const status = response.statusCode ?? 502;
          const empty =
            incoming.method === "HEAD" || [204, 205, 304].includes(status);
          if (empty) response.resume();
          resolve(
            new Response(empty ? null : responseBody(response), {
              status,
              headers: responseHeaders(response),
            }),
          );
        },
      );
      outgoing.once("error", reject);
      outgoing.end(body);
    });
  };
  close(): void {
    this.agent.destroy();
  }
}
