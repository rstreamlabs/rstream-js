// See LICENSE file in the project root for license information.

import { FileSystemError } from "./types";
import { z } from "zod";

export const fileSystemTransportPath = "/.rstream/files/v1";

const chunkSize = 32768;
const receiveWindow = 32;
const iceServerSchema = z.object({
  urls: z.array(z.string()).max(16),
  username: z.string().optional(),
  credential: z.string().optional(),
  credentialType: z.string().optional(),
});

export const fileSystemTransportSchema = z.object({
  version: z.literal(1),
  backend: z.enum(["webdav", "webrtc"]),
  ice_servers: z.array(iceServerSchema).max(16).optional(),
  lease_seconds: z.number().int().min(1).max(3600).optional(),
  restart_seconds: z.number().int().min(1).max(3600).optional(),
});

const answerSchema = z.object({
  session: z.string().min(1).max(128),
  sdp: z.string().min(1).max(65536),
});
const responseSchema = z.object({
  status: z.number().int().min(200).max(599).optional(),
  headers: z.record(z.string(), z.array(z.string())).optional(),
  done: z.boolean().optional(),
  error: z.string().optional(),
});

export type FileSystemTransportInfo = z.infer<typeof fileSystemTransportSchema>;

export interface FileSystemRTCOptions {
  createPeerConnection?: (
    configuration: RTCConfiguration,
  ) => RTCPeerConnection | Promise<RTCPeerConnection>;
  iceTransportPolicy?: RTCIceTransportPolicy;
}

export interface RTCFetchOptions extends FileSystemRTCOptions {
  fetch: typeof fetch;
  endpoint: URL;
  info: FileSystemTransportInfo;
}

async function createPeer(
  options: RTCFetchOptions,
): Promise<RTCPeerConnection> {
  const configuration: RTCConfiguration = {
    iceServers: options.info.ice_servers?.map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential,
    })),
    iceTransportPolicy: options.iceTransportPolicy,
  };
  if (options.createPeerConnection)
    return options.createPeerConnection(configuration);
  if (typeof RTCPeerConnection !== "undefined")
    return new RTCPeerConnection(configuration);
  if (typeof window !== "undefined")
    throw new Error("WebRTC is unavailable in this browser.");
  const native = await import("@roamhq/wrtc").catch(() => {
    throw new Error(
      "WebRTC requires the optional @roamhq/wrtc package in this Node runtime.",
    );
  });
  const implementation = native.default ?? native;
  return new implementation.RTCPeerConnection(configuration);
}

export async function readSignalJSON(response: Response): Promise<unknown> {
  if (!response.body)
    throw new Error("Filesystem signaling response is empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const size = { value: 0 };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size.value += chunk.value.byteLength;
      if (size.value > 131072)
        throw new Error("Filesystem signaling response is too large.");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size.value);
    chunks.reduce((offset, chunk) => {
      bytes.set(chunk, offset);
      return offset + chunk.byteLength;
    }, 0);
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function gather(
  peer: RTCPeerConnection,
  signal: AbortSignal,
  restart = false,
): Promise<string> {
  await peer.setLocalDescription(
    await peer.createOffer({ iceRestart: restart }),
  );
  if (peer.iceGatheringState !== "complete") {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        peer.removeEventListener("icegatheringstatechange", change);
        signal.removeEventListener("abort", abort);
      };
      const change = () => {
        if (peer.iceGatheringState !== "complete") return;
        finish();
        resolve();
      };
      const abort = () => {
        finish();
        reject(signal.reason);
      };
      peer.addEventListener("icegatheringstatechange", change);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else change();
    });
  }
  signal.throwIfAborted();
  const sdp = peer.localDescription?.sdp;
  if (!sdp) throw new Error("Filesystem WebRTC offer is empty.");
  return sdp;
}

export function isFileSystemRead(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "PROPFIND";
}

export async function webRTCResponse(
  request: Request,
  options: RTCFetchOptions,
): Promise<Response> {
  if (!isFileSystemRead(request.method)) {
    await request.body?.cancel();
    return new Response(
      "WebRTC filesystem is read-only; writing is not supported",
      { status: 403 },
    );
  }
  request.signal.throwIfAborted();
  const peer = await createPeer(options);
  return new Promise<Response>((resolve, reject) => {
    try {
      const transfer = new RTCResponse(peer, request, options, resolve, reject);
      void transfer.start().catch((error: unknown) => transfer.fail(error));
    } catch (error) {
      peer.close();
      reject(error);
    }
  });
}

class RTCResponse {
  private readonly channel: RTCDataChannel;
  private readonly abort = new AbortController();
  private readonly queue: Uint8Array<ArrayBuffer>[] = [];
  private readonly signal: AbortSignal;
  private readonly onAbort = () => this.fail(this.request.signal.reason);
  private pending: (() => void) | null = null;
  private error: Error | null = null;
  private complete = false;
  private expected: number | null = null;
  private received = 0;
  private headers = false;
  private closed = false;
  private session = "";
  private restarted = Date.now();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private setupTimer: ReturnType<typeof setTimeout> | undefined;
  public constructor(
    private readonly peer: RTCPeerConnection,
    private readonly request: Request,
    private readonly options: RTCFetchOptions,
    private readonly resolve: (response: Response) => void,
    private readonly reject: (error: Error) => void,
  ) {
    this.signal = this.abort.signal;
    this.channel = peer.createDataChannel("rstream.files.v1", {
      ordered: true,
    });
    this.channel.binaryType = "arraybuffer";
    this.channel.onmessage = (event: MessageEvent<unknown>) => {
      try {
        this.message(event.data);
      } catch (error) {
        this.fail(error);
      }
    };
    this.channel.onerror = () =>
      this.fail(new Error("Filesystem WebRTC channel failed."));
    this.channel.onclose = () => {
      if (!this.complete && !this.closed)
        this.fail(
          new Error(
            "Filesystem WebRTC channel closed before transfer completed.",
          ),
        );
    };
    this.peer.onconnectionstatechange = () => {
      if (
        ["failed", "disconnected"].includes(peer.connectionState) &&
        !this.complete &&
        !this.closed
      )
        this.fail(new Error("Filesystem WebRTC connection interrupted."));
    };
    this.request.signal.addEventListener("abort", this.onAbort, { once: true });
    this.setupTimer = setTimeout(
      () => this.fail(new Error("Filesystem WebRTC connection timed out.")),
      20000,
    );
  }
  public async start(): Promise<void> {
    this.request.signal.throwIfAborted();
    const sdp = await gather(this.peer, this.signal);
    const url = new URL(this.request.url);
    const headers = Object.fromEntries(
      Array.from(this.request.headers)
        .filter(([name]) => name !== "authorization" && name !== "cookie")
        .map(([name, value]) => [name, [value]]),
    );
    const body = this.request.body ? await this.request.text() : "";
    if (new TextEncoder().encode(body).length > 16384)
      throw new Error("Filesystem request exceeds 16 KiB.");
    const answer = answerSchema.parse(
      await this.signaling({
        action: "offer",
        sdp,
        request: {
          method: this.request.method,
          uri: url.pathname + url.search,
          headers,
          body,
        },
      }),
    );
    this.session = answer.session;
    await this.peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    this.renewLater();
  }
  private async signaling(body: object): Promise<unknown> {
    const headers = new Headers(this.request.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("Range");
    headers.delete("If-Range");
    headers.delete("Content-Length");
    const fetchResponse = this.options.fetch;
    const response = await fetchResponse(this.options.endpoint, {
      method: "POST",
      headers,
      credentials: this.request.credentials,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(20000)]),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FileSystemError(
        "Filesystem signaling",
        response.status,
        response.statusText,
      );
    }
    return readSignalJSON(response);
  }
  private renewLater(): void {
    if (this.closed) return;
    this.timer = setTimeout(
      () => {
        void this.renew()
          .then(() => this.renewLater())
          .catch((error: unknown) => this.fail(error));
      },
      Math.max(1000, ((this.options.info.lease_seconds ?? 90) * 1000) / 3),
    );
  }
  private async renew(): Promise<void> {
    if (
      !this.headers ||
      Date.now() - this.restarted <
        (this.options.info.restart_seconds ?? 300) * 1000
    ) {
      await this.signaling({ action: "renew", session: this.session });
      return;
    }
    const headers = new Headers(this.request.headers);
    headers.delete("Range");
    headers.delete("If-Range");
    headers.delete("Content-Length");
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(20000)]);
    const fetchResponse = this.options.fetch;
    const response = await fetchResponse(this.options.endpoint, {
      headers,
      credentials: this.request.credentials,
      redirect: "error",
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FileSystemError(
        "Filesystem ICE refresh",
        response.status,
        response.statusText,
      );
    }
    const info = fileSystemTransportSchema.parse(
      await readSignalJSON(response),
    );
    this.peer.setConfiguration({
      ...this.peer.getConfiguration(),
      iceServers: info.ice_servers?.map((server) => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential,
      })),
    });
    const sdp = await gather(this.peer, signal, true);
    const answer = answerSchema.parse(
      await this.signaling({ action: "restart", session: this.session, sdp }),
    );
    await this.peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    this.restarted = Date.now();
  }
  private message(data: unknown): void {
    if (this.closed) return;
    if (data instanceof ArrayBuffer) {
      if (
        !this.headers ||
        this.complete ||
        data.byteLength > chunkSize ||
        this.queue.length >= receiveWindow
      )
        throw new Error(
          "Filesystem receive window exceeded or invalid data frame.",
        );
      this.received += data.byteLength;
      if (this.expected !== null && this.received > this.expected)
        throw new Error("Filesystem response exceeds content length.");
      this.queue.push(new Uint8Array(data));
      this.wake();
      return;
    }
    if (typeof data !== "string" || data.length > 131072)
      throw new Error("Invalid filesystem response.");
    const frame = responseSchema.parse(JSON.parse(data));
    if (frame.error) throw new Error(frame.error);
    if (frame.done) {
      if (!this.headers || this.complete)
        throw new Error("Invalid filesystem completion.");
      if (this.expected !== null && this.received !== this.expected)
        throw new Error(
          "Filesystem transfer ended before the complete file was received.",
        );
      this.complete = true;
      this.wake();
      return;
    }
    if (!frame.status || this.headers)
      throw new Error("Invalid filesystem response headers.");
    this.headers = true;
    clearTimeout(this.setupTimer);
    const headers = new Headers(
      Object.entries(frame.headers ?? {}).flatMap(([name, values]) =>
        values.map((value): [string, string] => [name, value]),
      ),
    );
    const length = headers.get("Content-Length");
    if (length !== null) {
      if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
        throw new Error("Invalid filesystem content length.");
      this.expected = Number(length);
    }
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
      {
        pull: (controller) => this.pull(controller),
        cancel: () => this.close(),
      },
      { highWaterMark: 0 },
    );
    if (
      this.request.method === "HEAD" ||
      [204, 205, 304].includes(frame.status)
    ) {
      this.resolve(new Response(null, { status: frame.status, headers }));
      void stream.cancel();
      return;
    }
    this.resolve(new Response(stream, { status: frame.status, headers }));
  }
  private async pull(
    controller: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>,
  ): Promise<void> {
    if (this.queue.length === 0 && !this.complete && !this.error)
      await new Promise<void>((resolve) => {
        this.pending = resolve;
      });
    if (this.error) {
      controller.error(this.error);
      return;
    }
    const chunk = this.queue.shift();
    if (chunk) {
      controller.enqueue(chunk);
      if (this.channel.readyState === "open") this.channel.send("credit");
      return;
    }
    if (this.complete) {
      if (this.channel.readyState === "open") this.channel.send("done");
      controller.close();
      this.close();
    }
  }
  private wake(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.();
  }
  public fail(error: unknown): void {
    if (this.closed) return;
    this.error =
      error instanceof Error ? error : new Error("Filesystem transfer failed.");
    this.reject(this.error);
    this.wake();
    this.close();
  }
  private close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.setupTimer);
    this.abort.abort();
    this.request.signal.removeEventListener("abort", this.onAbort);
    this.channel.close();
    this.peer.close();
    this.wake();
  }
}
