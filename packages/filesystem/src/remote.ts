// See LICENSE file in the project root for license information.

import type { FileSystemError } from "./types";
import { fileSystemTransportPath } from "./rtc";
import { fileSystemTransportSchema } from "./rtc";
import { readSignalJSON } from "./rtc";
import { resolveFileSystemURL } from "./webdav";
import { webRTCResponse } from "./rtc";
import { WebDAVFileSystem } from "./webdav";
import type { FileSystemConfig } from "./types";
import type { FileSystemRTCOptions } from "./rtc";

export interface RemoteFileSystemConfig extends FileSystemConfig {
  backend?: "auto" | "webdav" | "webrtc";
  rtc?: FileSystemRTCOptions;
}

function transportFetch(
  config: RemoteFileSystemConfig,
  createError: (
    operation: string,
    status: number,
    message: string,
  ) => FileSystemError,
): typeof fetch {
  const sourceFetch = config.fetch ?? fetch;
  if (config.backend === "webdav") return sourceFetch;
  return async (input, init) => {
    const request = new Request(input, init);
    try {
      const source =
        typeof config.url === "function" ? await config.url() : config.url;
      const endpoint = resolveFileSystemURL(source, "/", config.fsPath);
      if (new URL(request.url).origin !== endpoint.origin)
        throw new Error(
          "Filesystem requests must remain on the shared origin.",
        );
      endpoint.pathname =
        endpoint.pathname.replace(/\/$/, "") + fileSystemTransportPath;
      const headers = new Headers(request.headers);
      headers.delete("Range");
      headers.delete("If-Range");
      headers.delete("Content-Length");
      const discovery = await sourceFetch(endpoint, {
        headers,
        credentials: request.credentials,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      });
      if (discovery.status === 404 && config.backend !== "webrtc") {
        await discovery.body?.cancel();
        return await sourceFetch(request);
      }
      if (!discovery.ok) {
        await discovery.body?.cancel();
        throw createError(
          "Filesystem discovery",
          discovery.status,
          discovery.statusText,
        );
      }
      const info = fileSystemTransportSchema.parse(
        await readSignalJSON(discovery),
      );
      if (info.backend === "webdav") {
        if (config.backend === "webrtc")
          throw new Error(
            "The server does not offer the WebRTC filesystem backend.",
          );
        return await sourceFetch(request);
      }
      return await webRTCResponse(request, {
        ...config.rtc,
        createError,
        fetch: sourceFetch,
        endpoint,
        info,
      });
    } catch (error) {
      if (request.body && !request.body.locked)
        await request.body.cancel(error);
      throw error;
    }
  };
}

export class RemoteFileSystem extends WebDAVFileSystem {
  public constructor(config: RemoteFileSystemConfig) {
    super({
      ...config,
      fetch: transportFetch(config, (operation, status, message) =>
        this.createError(operation, status, message),
      ),
    });
  }
}

export class WebRTCFileSystem extends RemoteFileSystem {
  public constructor(config: RemoteFileSystemConfig) {
    super({ ...config, backend: "webrtc" });
  }
}
