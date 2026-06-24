// See LICENSE file in the project root for license information.

import * as z from "zod";

export const webTTYTransportSchema = z.enum([
  "plain",
  "websocket",
  "webtransport",
]);

export const webTTYRecordingModeSchema = z.enum(["recorded", "private"]);

export const webTTYEncryptionModeSchema = z.enum(["managed", "e2e"]);

export const webTTYSessionModeSchema = z.enum([
  "interactive",
  "non-interactive",
]);

export const webTTYOriginSchema = z.enum([
  "human",
  "codex",
  "api",
  "automation",
  "ci",
  "scheduled-job",
]);

export const webTTYParticipantRoleSchema = z.enum(["controller", "spectator"]);

export const webTTYInitiatorKindSchema = z.enum([
  "user",
  "app",
  "agent",
  "service-account",
]);

export const webTTYContextMetadataSchema = z
  .object({
    origin: webTTYOriginSchema.optional(),
    origin_id: z.string().optional(),
    purpose: z.string().optional(),
    initiator_kind: webTTYInitiatorKindSchema.optional(),
    agent_name: z.string().optional(),
    agent_version: z.string().optional(),
    request_id: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
