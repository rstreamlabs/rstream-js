// See LICENSE file in the project root for license information.

import { readBoundedText } from "./http-lifetime";

import { requestLifetime } from "./http-lifetime";

export function createBoundedControlPlaneFetch(
  timeoutMilliseconds: number,
  parent?: AbortSignal,
  fetch: typeof globalThis.fetch = globalThis.fetch,
  maxResponseBytes = 16384,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("Connection", "close");
    const lifetime = requestLifetime(
      [parent, request.signal],
      timeoutMilliseconds,
    );
    try {
      lifetime.signal.throwIfAborted();
      const response = await fetch(input, {
        ...init,
        redirect: "manual",
        headers,
        signal: lifetime.signal,
      });
      const responseBody =
        response.body === null
          ? null
          : await readBoundedText(response, maxResponseBytes);
      return new Response(responseBody, {
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status,
        statusText: response.statusText,
      });
    } finally {
      lifetime.close();
    }
  };
}
