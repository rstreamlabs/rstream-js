// See LICENSE file in the project root for license information.

import { webTTYContextMetadataSchema } from "./webtty-schemas";
import { webTTYEncryptionModeSchema } from "./webtty-schemas";
import { webTTYOriginSchema } from "./webtty-schemas";
import { webTTYParticipantRoleSchema } from "./webtty-schemas";
import { webTTYRecordingModeSchema } from "./webtty-schemas";
import { webTTYSessionModeSchema } from "./webtty-schemas";
import { webTTYTransportSchema } from "./webtty-schemas";
import * as z from "zod";
import type { RstreamTunnelsClient } from "./tunnels";

export {
  webTTYContextMetadataSchema,
  webTTYEncryptionModeSchema,
  webTTYOriginSchema,
  webTTYParticipantRoleSchema,
  webTTYRecordingModeSchema,
  webTTYSessionModeSchema,
  webTTYTransportSchema,
} from "./webtty-schemas";

const isoDateTimeSchema = z.string().datetime({ offset: true });

const decimalCursorSchema = z.string().regex(/^\d+$/);

const webTTYSequenceCursorInputSchema = z.union([
  decimalCursorSchema,
  z.number().int().nonnegative().safe().transform(String),
]);

const webTTYSessionStatusSchema = z.enum([
  "opening",
  "active",
  "closing",
  "closed",
  "errored",
]);

const webTTYControlRequestStatusSchema = z.enum([
  "pending",
  "granted",
  "refused",
  "revoked",
  "expired",
]);

const webTTYEventDirectionSchema = z.enum([
  "client_to_server",
  "server_to_client",
  "engine_internal",
]);

const webTTYStreamTypeSchema = z.enum(["stdin", "stdout", "stderr"]);

const webTTYSessionEventTypeSchema = z.enum([
  "open",
  "ack",
  "data",
  "resize",
  "close",
  "error",
  "participant",
  "control",
  "recording_state",
]);

const jsonRecordSchema = z.record(z.string(), z.unknown());

function rejectCryptoKeyEnvelopes(
  crypto: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (crypto === null || typeof crypto !== "object") {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(crypto, "key_envelopes")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "key_envelopes are available only from the WebTTY decrypt-material endpoint.",
      path: [...path, "key_envelopes"],
    });
  }
}

export const webTTYCapabilitiesSchema = z.object({
  managed_protocol: z.boolean(),
  store_configured: z.boolean(),
  session_listing: z.boolean(),
  recording: z.boolean(),
  replay: z.boolean(),
  live_attach: z.boolean(),
  control_transfer: z.boolean(),
  e2e: z.boolean(),
  implemented_transports: z.array(webTTYTransportSchema),
  recording_modes: z.array(webTTYRecordingModeSchema),
  encryption_modes: z.array(webTTYEncryptionModeSchema),
  required_permissions: z.record(z.string(), z.array(z.string())),
});

export const webTTYSessionLiveSchema = z.object({
  available: z.boolean(),
  attachable: z.boolean(),
  participant_count: z.number().int().nonnegative(),
  controller_participant_id: z.string().optional(),
  has_upstream: z.boolean(),
});

export const webTTYParticipantLiveSchema = z.object({
  connected: z.boolean(),
  controller: z.boolean(),
});

export const webTTYSessionSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string().optional(),
    project_id: z.string().optional(),
    cluster_id: z.string().optional(),
    server_id: z.string().optional(),
    tunnel_id: z.string(),
    client_id: z.string().optional(),
    initiator_user_id: z.string().optional(),
    group_id: z.string().optional(),
    status: webTTYSessionStatusSchema,
    session_mode: webTTYSessionModeSchema,
    recording_mode: webTTYRecordingModeSchema,
    encryption_mode: webTTYEncryptionModeSchema,
    downstream_transport: webTTYTransportSchema.optional(),
    upstream_transport: webTTYTransportSchema.optional(),
    command_meta: z.unknown().optional(),
    context: webTTYContextMetadataSchema.optional(),
    started_at: isoDateTimeSchema,
    ended_at: isoDateTimeSchema.optional(),
    exit_code: z.number().int().optional(),
    error_code: z.string().optional(),
    error_message: z.string().optional(),
    live: webTTYSessionLiveSchema.optional(),
  })
  .passthrough();

export const webTTYSessionGroupSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string().optional(),
    project_id: z.string().optional(),
    initiator_user_id: z.string().optional(),
    context: webTTYContextMetadataSchema.optional(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    closed_at: isoDateTimeSchema.optional(),
  })
  .passthrough();

export const webTTYParticipantSchema = z
  .object({
    id: z.string(),
    session_id: z.string(),
    user_id: z.string().optional(),
    device_id: z.string().optional(),
    browser_id: z.string().optional(),
    role: webTTYParticipantRoleSchema,
    attached_at: isoDateTimeSchema,
    detached_at: isoDateTimeSchema.optional(),
    controller: z.boolean(),
    grant_state: z.string().optional(),
    attach_grant: z.string().optional(),
    attach_grant_expires_at: isoDateTimeSchema.optional(),
    live: webTTYParticipantLiveSchema.optional(),
  })
  .passthrough();

export const webTTYCryptoMetadataSchema = z
  .object({
    payload_suite: z.string().optional(),
    payload_key_id: z.string().optional(),
    nonce: z.string().optional(),
    key_envelope_suite: z.string().optional(),
    key_envelopes: z.unknown().optional(),
    key_context: z.unknown().optional(),
    key_context_raw: z.string().optional(),
  })
  .passthrough();

export const webTTYSessionEventSchema = z
  .object({
    id: z.string(),
    session_id: z.string(),
    seq: decimalCursorSchema,
    created_at: isoDateTimeSchema,
    type: webTTYSessionEventTypeSchema,
    direction: webTTYEventDirectionSchema.optional(),
    stream_type: webTTYStreamTypeSchema.optional(),
    participant_id: z.string().optional(),
    payload_length: z.number().int().nonnegative().optional(),
    payload_ciphertext: z.string().optional(),
    payload_plaintext: z.string().optional(),
    crypto: webTTYCryptoMetadataSchema.optional(),
    prev_hash: z.string().optional(),
    hash: z.string().optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    rejectCryptoKeyEnvelopes(value.crypto, ctx, ["crypto"]);
  });

const webTTYKeyGrantBaseShape = {
  id: z.string(),
  session_id: z.string(),
  recipient_id: z.string(),
  recipient_kind: z.string(),
  granted_by: z.string().optional(),
  crypto: webTTYCryptoMetadataSchema,
  created_at: isoDateTimeSchema,
  revoked_at: isoDateTimeSchema.optional(),
};

export const webTTYKeyGrantSchema = z
  .object(webTTYKeyGrantBaseShape)
  .passthrough()
  .superRefine((value, ctx) => {
    if (Object.prototype.hasOwnProperty.call(value, "wrapped_key")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "wrapped_key is available only from the WebTTY decrypt-material endpoint.",
        path: ["wrapped_key"],
      });
    }
    rejectCryptoKeyEnvelopes(value.crypto, ctx, ["crypto"]);
  });

export const webTTYKeyGrantDecryptMaterialSchema = z
  .object({
    ...webTTYKeyGrantBaseShape,
    wrapped_key: z.string().optional(),
  })
  .passthrough();

export const webTTYControlRequestSchema = z
  .object({
    id: z.string(),
    session_id: z.string(),
    requester_participant_id: z.string(),
    requester_user_id: z.string().optional(),
    approver_participant_id: z.string().optional(),
    approver_user_id: z.string().optional(),
    status: webTTYControlRequestStatusSchema,
    reason: z.string().optional(),
    metadata: z.unknown().optional(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    resolved_at: isoDateTimeSchema.optional(),
    expires_at: isoDateTimeSchema.optional(),
  })
  .passthrough();

const listWebTTYSessionsFiltersSchema = z.object({
  server_id: z.string().optional(),
  tunnel_id: z.string().optional(),
  user_id: z.string().optional(),
  group_id: z.string().optional(),
  origin: webTTYOriginSchema.optional(),
  status: webTTYSessionStatusSchema.optional(),
  started_from: isoDateTimeSchema.optional(),
  started_to: isoDateTimeSchema.optional(),
});

export const listWebTTYSessionsParamsSchema = z.object({
  limit: z.number().int().min(1).optional(),
  filters: listWebTTYSessionsFiltersSchema.optional(),
});

const listWebTTYSessionGroupsFiltersSchema = z.object({
  initiator_user_id: z.string().optional(),
  origin: webTTYOriginSchema.optional(),
  created_from: isoDateTimeSchema.optional(),
  created_to: isoDateTimeSchema.optional(),
});

export const listWebTTYSessionGroupsParamsSchema = z.object({
  limit: z.number().int().min(1).optional(),
  filters: listWebTTYSessionGroupsFiltersSchema.optional(),
});

export const readWebTTYSessionEventsParamsSchema = z.object({
  from_seq: webTTYSequenceCursorInputSchema.optional(),
  limit: z.number().int().min(1).optional(),
});

export const listWebTTYKeyGrantDecryptMaterialParamsSchema = z.object({
  recipient_id: z.string().optional(),
  recipient_kind: z.string().optional(),
});

const listWebTTYControlRequestsFiltersSchema = z.object({
  status: webTTYControlRequestStatusSchema.optional(),
  requester_user_id: z.string().optional(),
});

export const listWebTTYControlRequestsParamsSchema = z.object({
  limit: z.number().int().min(1).optional(),
  filters: listWebTTYControlRequestsFiltersSchema.optional(),
});

export const attachWebTTYParticipantParamsSchema = z.object({
  role: z.literal("spectator").optional(),
  device_id: z.string().optional(),
  browser_id: z.string().optional(),
  transport: webTTYTransportSchema.optional(),
  grant_state: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
});

export const detachWebTTYParticipantParamsSchema = z.object({
  reason: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
});

export const createWebTTYControlRequestParamsSchema = z.object({
  participant_id: z.string(),
  reason: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
  expires_at: isoDateTimeSchema.optional(),
});

export const resolveWebTTYControlRequestParamsSchema = z.object({
  action: z.enum(["grant", "refuse", "revoke"]),
  approver_participant_id: z.string().optional(),
  reason: z.string().optional(),
});

export type WebTTYCapabilities = z.infer<typeof webTTYCapabilitiesSchema>;
export type WebTTYSessionLive = z.infer<typeof webTTYSessionLiveSchema>;
export type WebTTYParticipantLive = z.infer<typeof webTTYParticipantLiveSchema>;
export type WebTTYSession = z.infer<typeof webTTYSessionSchema>;
export type WebTTYSessionGroup = z.infer<typeof webTTYSessionGroupSchema>;
export type WebTTYParticipant = z.infer<typeof webTTYParticipantSchema>;
export type WebTTYSessionEvent = z.infer<typeof webTTYSessionEventSchema>;
export type WebTTYKeyGrant = z.infer<typeof webTTYKeyGrantSchema>;
export type WebTTYKeyGrantDecryptMaterial = z.infer<
  typeof webTTYKeyGrantDecryptMaterialSchema
>;
export type WebTTYControlRequest = z.infer<typeof webTTYControlRequestSchema>;
export type ListWebTTYSessionsParams = z.input<
  typeof listWebTTYSessionsParamsSchema
>;
export type ListWebTTYSessionGroupsParams = z.input<
  typeof listWebTTYSessionGroupsParamsSchema
>;
export type ReadWebTTYSessionEventsParams = z.input<
  typeof readWebTTYSessionEventsParamsSchema
>;
export type ListWebTTYKeyGrantDecryptMaterialParams = z.input<
  typeof listWebTTYKeyGrantDecryptMaterialParamsSchema
>;
export type ListWebTTYControlRequestsParams = z.input<
  typeof listWebTTYControlRequestsParamsSchema
>;
export type AttachWebTTYParticipantParams = z.input<
  typeof attachWebTTYParticipantParamsSchema
>;
export type DetachWebTTYParticipantParams = z.input<
  typeof detachWebTTYParticipantParamsSchema
>;
export type CreateWebTTYControlRequestParams = z.input<
  typeof createWebTTYControlRequestParamsSchema
>;
export type ResolveWebTTYControlRequestParams = z.input<
  typeof resolveWebTTYControlRequestParamsSchema
>;

const webTTYSessionListSchema = z.array(webTTYSessionSchema);
const webTTYSessionGroupListSchema = z.array(webTTYSessionGroupSchema);
const webTTYParticipantListSchema = z.array(webTTYParticipantSchema);
const webTTYSessionEventListSchema = z.array(webTTYSessionEventSchema);
const webTTYKeyGrantListSchema = z.array(webTTYKeyGrantSchema);
const webTTYKeyGrantDecryptMaterialListSchema = z.array(
  webTTYKeyGrantDecryptMaterialSchema,
);
const webTTYControlRequestListSchema = z.array(webTTYControlRequestSchema);

function pathId(kind: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${kind} is required.`);
  }
  return encodeURIComponent(normalized);
}

function pathWithParams(path: string, params: unknown): string {
  if (params === undefined) {
    return path;
  }
  return `${path}?params=${encodeURIComponent(JSON.stringify(params))}`;
}

export class RstreamWebTTYResource {
  private readonly client: RstreamTunnelsClient;

  constructor(client: RstreamTunnelsClient) {
    this.client = client;
  }

  async capabilities(): Promise<WebTTYCapabilities> {
    const response = await this.client.request<unknown>(
      "/webtty/capabilities",
      {
        method: "GET",
      },
    );
    return webTTYCapabilitiesSchema.parse(response);
  }

  async listGroups(
    params?: ListWebTTYSessionGroupsParams,
  ): Promise<WebTTYSessionGroup[]> {
    const parsed =
      params === undefined
        ? undefined
        : listWebTTYSessionGroupsParamsSchema.parse(params);
    const response = await this.client.request<unknown>(
      pathWithParams("/webtty/groups", parsed),
      { method: "GET" },
    );
    return webTTYSessionGroupListSchema.parse(response);
  }

  async getGroup(groupId: string): Promise<WebTTYSessionGroup> {
    const response = await this.client.request<unknown>(
      `/webtty/groups/${pathId("Session group ID", groupId)}`,
      { method: "GET" },
    );
    return webTTYSessionGroupSchema.parse(response);
  }

  async listSessions(
    params?: ListWebTTYSessionsParams,
  ): Promise<WebTTYSession[]> {
    const parsed =
      params === undefined
        ? undefined
        : listWebTTYSessionsParamsSchema.parse(params);
    const response = await this.client.request<unknown>(
      pathWithParams("/webtty/sessions", parsed),
      { method: "GET" },
    );
    return webTTYSessionListSchema.parse(response);
  }

  async getSession(sessionId: string): Promise<WebTTYSession> {
    const response = await this.client.request<unknown>(
      `/webtty/sessions/${pathId("Session ID", sessionId)}`,
      { method: "GET" },
    );
    return webTTYSessionSchema.parse(response);
  }

  async listParticipants(sessionId: string): Promise<WebTTYParticipant[]> {
    const response = await this.client.request<unknown>(
      `/webtty/sessions/${pathId("Session ID", sessionId)}/participants`,
      { method: "GET" },
    );
    return webTTYParticipantListSchema.parse(response);
  }

  async attachParticipant(
    sessionId: string,
    params: AttachWebTTYParticipantParams = {},
  ): Promise<WebTTYParticipant> {
    const response = await this.client.request<unknown>(
      `/webtty/sessions/${pathId("Session ID", sessionId)}/participants`,
      {
        body: JSON.stringify(attachWebTTYParticipantParamsSchema.parse(params)),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return webTTYParticipantSchema.parse(response);
  }

  async detachParticipant(
    sessionId: string,
    participantId: string,
    params: DetachWebTTYParticipantParams = {},
  ): Promise<WebTTYParticipant> {
    const response = await this.client.request<unknown>(
      `/webtty/sessions/${pathId("Session ID", sessionId)}/participants/${pathId("Participant ID", participantId)}`,
      {
        body: JSON.stringify(detachWebTTYParticipantParamsSchema.parse(params)),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return webTTYParticipantSchema.parse(response);
  }

  async readEvents(
    sessionId: string,
    params?: ReadWebTTYSessionEventsParams,
  ): Promise<WebTTYSessionEvent[]> {
    const parsed =
      params === undefined
        ? undefined
        : readWebTTYSessionEventsParamsSchema.parse(params);
    const response = await this.client.request<unknown>(
      pathWithParams(
        `/webtty/sessions/${pathId("Session ID", sessionId)}/events`,
        parsed,
      ),
      { method: "GET" },
    );
    return webTTYSessionEventListSchema.parse(response);
  }

  async listKeyGrants(sessionId: string): Promise<WebTTYKeyGrant[]> {
    const response = await this.client.request<unknown>(
      `/webtty/sessions/${pathId("Session ID", sessionId)}/key-grants`,
      { method: "GET" },
    );
    return webTTYKeyGrantListSchema.parse(response);
  }

  async listKeyGrantDecryptMaterial(
    sessionId: string,
    params?: ListWebTTYKeyGrantDecryptMaterialParams,
  ): Promise<WebTTYKeyGrantDecryptMaterial[]> {
    const parsed =
      params === undefined
        ? undefined
        : listWebTTYKeyGrantDecryptMaterialParamsSchema.parse(params);
    const response = await this.client.request<unknown>(
      pathWithParams(
        `/webtty/sessions/${pathId("Session ID", sessionId)}/key-grants/decrypt-material`,
        parsed,
      ),
      { method: "GET" },
    );
    return webTTYKeyGrantDecryptMaterialListSchema.parse(response);
  }

  async listControlRequests(
    sessionId: string,
    params?: ListWebTTYControlRequestsParams,
  ): Promise<WebTTYControlRequest[]> {
    const parsed =
      params === undefined
        ? undefined
        : listWebTTYControlRequestsParamsSchema.parse(params);
    const response = await this.client.request<unknown>(
      pathWithParams(
        `/webtty/sessions/${pathId("Session ID", sessionId)}/control-requests`,
        parsed,
      ),
      { method: "GET" },
    );
    return webTTYControlRequestListSchema.parse(response);
  }

  async createControlRequest(
    sessionId: string,
    params: CreateWebTTYControlRequestParams,
  ): Promise<WebTTYControlRequest> {
    const response = await this.client.request<unknown>(
      `/webtty/sessions/${pathId("Session ID", sessionId)}/control-requests`,
      {
        body: JSON.stringify(
          createWebTTYControlRequestParamsSchema.parse(params),
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return webTTYControlRequestSchema.parse(response);
  }

  async resolveControlRequest(
    sessionId: string,
    requestId: string,
    params: ResolveWebTTYControlRequestParams,
  ): Promise<WebTTYControlRequest> {
    const response = await this.client.request<unknown>(
      `/webtty/sessions/${pathId("Session ID", sessionId)}/control-requests/${pathId("Control request ID", requestId)}`,
      {
        body: JSON.stringify(
          resolveWebTTYControlRequestParamsSchema.parse(params),
        ),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return webTTYControlRequestSchema.parse(response);
  }
}
