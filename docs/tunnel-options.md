# Node.js tunnel options

These options apply to `createTunnel()` in [`@rstreamlabs/runtime`](../packages/runtime/README.md). The Engine API represents inventory fields separately from runtime input options.

## HTTP CORS

`@rstreamlabs/runtime` accepts `httpCors: { allowedOrigins: ["https://dashboard.example"], allowedMethods: ["GET", "PUT"], allowedHeaders: ["Authorization"], exposedHeaders: ["ETag"], allowCredentials: false, maxAge: 600 }` in `createTunnel`. Runtime properties use camelCase; inventory JSON uses `http_cors` and snake_case fields.

CORS requires a published HTTP tunnel. Allowed origins must be explicit HTTP(S) origins without paths or wildcards. Omitted method and request-header lists use GET/HEAD/POST and Authorization/Content-Type; credentials are disabled and max age is zero by default. An absent policy preserves upstream CORS. Engine answers valid preflights before request authentication, but every actual request still requires its usual authorization. A preflight does not grant access to the upstream application.
