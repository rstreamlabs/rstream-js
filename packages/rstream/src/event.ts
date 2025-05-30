// See LICENSE file in the project root for license information.

import { clientSchema } from "./client";
import { tunnelSchema } from "./tunnel";
import * as z from "zod";

export const eventSchema = z.union([
  z.object({
    type: z.literal("client.created"),
    object: clientSchema,
  }),
  z.object({
    type: z.literal("client.updated"),
    object: clientSchema,
  }),
  z.object({
    type: z.literal("client.deleted"),
    object: clientSchema,
  }),
  z.object({
    type: z.literal("tunnel.created"),
    object: tunnelSchema,
  }),
  z.object({
    type: z.literal("tunnel.updated"),
    object: tunnelSchema,
  }),
  z.object({
    type: z.literal("tunnel.deleted"),
    object: tunnelSchema,
  }),
]);

export type Event = z.infer<typeof eventSchema>;
