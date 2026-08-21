// See LICENSE file in the project root for license information.

interface RequestLifetime {
  close(): void;
  signal: AbortSignal;
}

function createRequestLifetime(
  parent: AbortSignal,
  timeoutMilliseconds: number,
): RequestLifetime {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) {
    abort();
  } else {
    parent.addEventListener("abort", abort, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new Error("Control plane request timed out.")),
    timeoutMilliseconds,
  );
  return {
    close: () => {
      clearTimeout(timeout);
      parent.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
}

export function createBoundedControlPlaneFetch(
  timeoutMilliseconds: number,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("Connection", "close");
    const lifetime = createRequestLifetime(request.signal, timeoutMilliseconds);
    try {
      const response = await globalThis.fetch(request, {
        headers,
        signal: lifetime.signal,
      });
      const responseBody =
        response.body === null
          ? null
          : new Uint8Array(await response.arrayBuffer());
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
