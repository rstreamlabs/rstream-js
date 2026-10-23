// See LICENSE file in the project root for license information.

import { clientFilterSchema } from "./client";
import { listedClientSchema } from "./client";
import { listClientsParamsSchema } from "./client";
import { wsEventsSchema } from "./event";
import { listTunnelsParamsSchema } from "./tunnel";
import { tunnelFilterSchema } from "./tunnel";
import { listedTunnelSchema } from "./tunnel";
import * as z from "zod";
import type { ZodType } from "zod";

const jsonContentType = "application/json";
const openApiContentType = "application/vnd.oai.openapi+json;version=3.1";

type OpenApiRule = {
  readonly resource: string | readonly string[];
  readonly action: string | readonly string[];
};

type OpenApiPermission = {
  readonly name: string;
  readonly description: string;
  readonly rules: readonly OpenApiRule[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dropSchemaKeyword(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "$schema"),
  );
}

function jsonSchemaFor(schema: ZodType): unknown {
  return dropSchemaKeyword(
    z.toJSONSchema(schema, {
      unrepresentable: "any",
      override: (ctx) => {
        if (ctx.zodSchema instanceof z.ZodDate) {
          ctx.jsonSchema.type = "string";
          ctx.jsonSchema.format = "date-time";
        }
      },
    }),
  );
}

function jsonArrayResponse(description: string, itemSchemaRef: string) {
  return {
    description,
    content: {
      [jsonContentType]: {
        schema: {
          type: "array",
          items: {
            $ref: itemSchemaRef,
          },
        },
      },
    },
  };
}

function streamResponse(description: string) {
  return {
    description,
    content: {
      "text/event-stream": {
        schema: {
          type: "string",
        },
      },
    },
  };
}

function errorResponse(description: string) {
  return {
    description,
  };
}

function queryJsonParameter(
  name: string,
  description: string,
  schemaRef: string,
  examples?: Record<string, { readonly value: unknown }>,
) {
  return {
    name,
    in: "query",
    required: false,
    description,
    content: {
      [jsonContentType]: {
        schema: {
          $ref: schemaRef,
        },
        ...(examples ? { examples } : {}),
      },
    },
  };
}

const readEngineStateRule: OpenApiRule = {
  resource: ["engine.tunnels", "engine.streams"],
  action: "read",
};

const readEngineStateRules: readonly OpenApiRule[] = [readEngineStateRule];

const watchParamsSchema = z.object({
  clients: clientFilterSchema.optional(),
  tunnels: tunnelFilterSchema.optional(),
});

const enginePermissions: Record<string, OpenApiPermission> = {
  "turn.credentials.create": {
    name: "TURN Credentials: Create",
    description:
      "Issue short-lived TURN credentials through either the Control plane or Engine API.",
    rules: [
      {
        resource: [
          "api.turn-server.credentials",
          "engine.turn-server.credentials",
        ],
        action: "create",
      },
    ],
  },
  "tunnels.resources.read-only": {
    name: "Discovery: Read-Only",
    description: "Read active clients, active tunnels, and live state events.",
    rules: [readEngineStateRule],
  },
  "tunnels.tunnels.create-delete": {
    name: "Tunnels: Create and Delete",
    description:
      "Create and close tunnels through the CLI, SDK, or engine control channel.",
    rules: [
      {
        resource: "engine.tunnels",
        action: ["create", "delete"],
      },
    ],
  },
  "tunnels.streams.create-delete": {
    name: "Connections: Create and Delete",
    description:
      "Open and close private tunnel streams and WebTTY connections.",
    rules: [
      {
        resource: "engine.streams",
        action: ["create", "delete"],
      },
    ],
  },
  "webtty.sessions.read-only": {
    name: "WebTTY Sessions: Read-Only",
    description:
      "List managed WebTTY sessions, participants, replay state, and join as a spectator.",
    rules: [
      {
        resource: "engine.webtty.sessions",
        action: "read",
      },
    ],
  },
  "webtty.sessions.read-write": {
    name: "WebTTY Sessions: Read and Write",
    description:
      "Create managed WebTTY sessions and coordinate control requests for active sessions.",
    rules: [
      {
        resource: "engine.webtty.sessions",
        action: ["read", "write"],
      },
    ],
  },
  "webtty.logs.read-only": {
    name: "WebTTY Session Logs: Read-Only",
    description:
      "Read managed WebTTY session logs. End-to-end encrypted content still requires trusted local key material.",
    rules: [
      {
        resource: "engine.webtty.sessions",
        action: "read",
      },
      {
        resource: "engine.webtty.logs",
        action: "read",
      },
    ],
  },
};

export const engineOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "rstream Engine API",
    version: "1.0.0",
    description:
      "Operational Engine API exposed by rstream engine. This surface is scoped to the authenticated engine or project endpoint and covers live clients, live tunnels, and state-change streams.",
  },
  servers: [
    {
      url: "https://{engine}",
      description: "Project-scoped rstream engine endpoint.",
      variables: {
        engine: {
          default: "project-endpoint.cluster-host:443",
          description:
            "Use the engine value returned by project discovery or configured in RSTREAM_ENGINE.",
        },
      },
    },
  ],
  security: [{ bearerAuth: [] }, { mutualTLS: [] }],
  components: {
    securitySchemes: {
      mutualTLS: {
        type: "mutualTLS",
        description:
          "EE project API only, on the dedicated authority returned by anonymous HTTPS discovery. Present one registered client certificate without a bearer or query token. Ordinary browser-facing hosts never request a client certificate.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "rstream token",
        description:
          "Preferred authentication mechanism. Send an OAuth-issued rstream access token or compatible rstream credential in Authorization: Bearer <token>.",
      },
    },
    parameters: {
      ListClientsParams: queryJsonParameter(
        "params",
        "JSON-encoded ListClientsParams object.",
        "#/components/schemas/ListClientsParams",
        {
          filterByAgent: {
            value: {
              limit: 10,
              filters: {
                agent: "rstream",
                channel: "stable",
              },
            },
          },
        },
      ),
      ListTunnelsParams: queryJsonParameter(
        "params",
        "JSON-encoded ListTunnelsParams object.",
        "#/components/schemas/ListTunnelsParams",
        {
          filterByLabels: {
            value: {
              filters: {
                labels: {
                  service: "ssh",
                  env: "prod",
                },
              },
            },
          },
        },
      ),
      WatchParams: queryJsonParameter(
        "params",
        "JSON-encoded WatchParams object. The same shape is accepted by SSE and WebSocket transports.",
        "#/components/schemas/WatchParams",
        {
          watchTaggedTunnels: {
            value: {
              clients: {
                agent: "rstream",
              },
              tunnels: {
                labels: {
                  service: "ssh",
                },
              },
            },
          },
        },
      ),
    },
    responses: {
      BadRequest: errorResponse("Request validation failed."),
      Unauthorized: errorResponse("Authentication is required."),
      Forbidden: errorResponse("The token is not authorized."),
    },
    schemas: {
      EngineDiscovery: {
        type: "object",
        required: ["version", "projectEndpoint", "mtlsApiUrl", "capabilities"],
        properties: {
          version: { type: "integer", const: 1 },
          projectEndpoint: { type: "string" },
          mtlsApiUrl: {
            type: "string",
            format: "uri",
            example: "https://project.mtls.engine.example/api",
          },
          capabilities: {
            type: "array",
            items: { type: "string" },
            examples: [["engine-api-mtls", "turn-credentials-v2"]],
          },
        },
      },
      CreateTURNCredentials: {
        type: "object",
        additionalProperties: false,
        properties: {
          ttlSeconds: {
            type: "integer",
            minimum: 1,
            maximum: 3600,
            default: 600,
          },
        },
      },
      TURNCredentials: {
        type: "object",
        required: ["username", "credential", "urls", "ttl"],
        properties: {
          username: {
            type: "string",
            maxLength: 512,
            description:
              "Opaque short-lived v2 issued identity. Do not parse in clients.",
          },
          credential: {
            type: "string",
            maxLength: 1024,
            description: "Short-lived TURN password.",
          },
          urls: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: { type: "string", maxLength: 2048 },
          },
          ttl: {
            type: "integer",
            minimum: 1,
            maximum: 3600,
            description:
              "Effective remaining lifetime in seconds, clipped to identity, source credential and certificate expiry.",
          },
        },
      },

      Client: jsonSchemaFor(listedClientSchema),
      Event: jsonSchemaFor(wsEventsSchema),
      ListClientsParams: jsonSchemaFor(listClientsParamsSchema),
      ListTunnelsParams: jsonSchemaFor(listTunnelsParamsSchema),
      TunnelListItem: jsonSchemaFor(listedTunnelSchema),
      WatchParams: jsonSchemaFor(watchParamsSchema),
    },
  },
  "x-rstream-agent-authentication": {
    oauth_authorization_server_metadata:
      "https://rstream.io/.well-known/oauth-authorization-server",
    oauth_protected_resource_metadata:
      "https://rstream.io/.well-known/oauth-protected-resource",
    scope_selection:
      "Use x-rstream-required-rules to understand backend authorization checks. Choose OAuth scopes from x-rstream-permissions or use the task bundles in x-rstream-use-case-permissions.",
  },
  "x-rstream-permissions": enginePermissions,
  "x-rstream-use-case-permissions": {
    "inspect-engine-state": ["tunnels.resources.read-only"],
    "expose-service-from-cli": [
      "tunnels.resources.read-only",
      "tunnels.tunnels.create-delete",
    ],
    "connect-private-tunnel": [
      "tunnels.resources.read-only",
      "tunnels.streams.create-delete",
    ],
    "run-tunnel-webtty": [
      "tunnels.resources.read-only",
      "tunnels.tunnels.create-delete",
      "tunnels.streams.create-delete",
    ],
    "join-managed-webtty": ["webtty.sessions.read-only"],
    "control-managed-webtty": ["webtty.sessions.read-write"],
    "read-managed-webtty-recordings": ["webtty.logs.read-only"],
  },
  paths: {
    "/.well-known/rstream/engine": {
      get: {
        tags: ["Discovery"],
        summary: "Discover the dedicated project mTLS API.",
        operationId: "get_engine_discovery",
        description:
          "Anonymous GET on the ordinary project Engine authority. Follow the returned HTTPS URL; do not infer an mTLS hostname. Cache per client using Cache-Control (normally one hour). No certificate, bearer token, cookie or redirect is required. Available only where an explicit EE mapping is configured.",
        security: [],
        responses: {
          "200": {
            description:
              "Project-bound discovery. Capabilities describe enabled server features; callers still need the corresponding rights.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "public, max-age=3600",
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EngineDiscovery" },
              },
            },
          },
          "404": {
            description:
              "Dedicated mTLS API is not configured on this authority.",
          },
        },
      },
    },
    "/api/turn-server/credentials": {
      post: {
        tags: ["TURN"],
        summary: "Issue short-lived project TURN credentials.",
        operationId: "create_engine_turn_credentials",
        description:
          "EE managed projects. Same request and response contract as Control plane project TURN issuance. Empty body is valid. Issued credentials require turn.credentials.create only; turn.relay.allocate applies to local PAT/APP derivation. Issuance does not allocate a relay and does not bypass relay quotas or revocation checks.",
        security: [{ bearerAuth: [] }, { mutualTLS: [] }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateTURNCredentials" },
            },
          },
        },
        responses: {
          "200": {
            description: "Short-lived project TURN credentials.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TURNCredentials" },
              },
            },
          },
          "400": {
            description:
              "Malformed, unknown or out-of-range request fields; body exceeds 4 KiB.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
          },
          "401": {
            description:
              "Missing, invalid, expired or mixed authentication proofs.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
          },
          "403": {
            description:
              "Missing turn.credentials.create permission, workspace membership or project resource scope.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
          },
          "404": {
            description: "Project not found.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
          },
          "409": {
            description: "Project or serving infrastructure is inactive.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
          },
          "429": {
            description:
              "Rate limit exceeded; do not retry through another issuer.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
          },
          "503": {
            description:
              "Authentication backend, serving metadata or issued keyring unavailable.",
            headers: {
              "Cache-Control": {
                schema: { type: "string" },
                example: "no-store",
              },
            },
          },
        },
        "x-rstream-required-rules": [
          { resource: "engine.turn-server.credentials", action: "create" },
        ],
      },
    },

    "/api/openapi.json": {
      get: {
        tags: ["Discovery"],
        summary: "Return this OpenAPI description.",
        operationId: "get_engine_openapi",
        security: [],
        responses: {
          "200": {
            description: "OpenAPI document.",
            content: {
              [openApiContentType]: {
                schema: {
                  type: "object",
                },
              },
            },
          },
        },
      },
    },
    "/api/clients": {
      get: {
        tags: ["Runtime inventory"],
        summary: "List visible engine clients.",
        "x-rstream-token-scope": "resources.tunnels.scopes.clients.list",
        operationId: "list_engine_clients",
        parameters: [{ $ref: "#/components/parameters/ListClientsParams" }],
        security: [{ bearerAuth: [] }, { mutualTLS: [] }],
        responses: {
          "200": jsonArrayResponse(
            "Visible clients. Fine-grained list scopes may filter objects and project fields.",
            "#/components/schemas/Client",
          ),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
        "x-rstream-required-rules": readEngineStateRules,
      },
    },
    "/api/tunnels": {
      get: {
        tags: ["Runtime inventory"],
        summary: "List visible engine tunnels.",
        operationId: "list_engine_tunnels",
        parameters: [{ $ref: "#/components/parameters/ListTunnelsParams" }],
        security: [{ bearerAuth: [] }, { mutualTLS: [] }],
        responses: {
          "200": jsonArrayResponse(
            "Visible tunnels. Fine-grained list scopes may filter objects and project fields.",
            "#/components/schemas/TunnelListItem",
          ),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
        "x-rstream-required-rules": readEngineStateRules,
        "x-rstream-token-metadata-scope":
          "resources.tunnels.scopes.tunnels.list",
      },
    },
    "/api/sse": {
      get: {
        tags: ["Runtime watch"],
        summary:
          "Subscribe to visible engine state through Server-Sent Events.",
        operationId: "watch_engine_events_sse",
        parameters: [{ $ref: "#/components/parameters/WatchParams" }],
        security: [{ bearerAuth: [] }, { mutualTLS: [] }],
        responses: {
          "200": streamResponse(
            "SSE stream. Each event is emitted as a data line containing a JSON Event object.",
          ),
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
        "x-rstream-event-schema": "#/components/schemas/Event",
        "x-rstream-required-rules": readEngineStateRules,
      },
    },
    "/api/websocket": {
      get: {
        tags: ["Runtime watch"],
        summary:
          "Subscribe to visible engine state through a WebSocket upgrade.",
        operationId: "watch_engine_events_websocket",
        parameters: [{ $ref: "#/components/parameters/WatchParams" }],
        security: [{ bearerAuth: [] }, { mutualTLS: [] }],
        responses: {
          "101": {
            description:
              "WebSocket connection accepted. Frames contain JSON Event objects.",
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
        "x-rstream-event-schema": "#/components/schemas/Event",
        "x-rstream-required-rules": readEngineStateRules,
      },
    },
  },
};

export const engineOpenApiJson = `${JSON.stringify(
  engineOpenApiDocument,
  null,
  2,
)}\n`;
