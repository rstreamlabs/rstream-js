// See LICENSE file in the project root for license information.

import * as z from "zod";

import { clientSchema } from "@rstreamlabs/rstream/client";
export { clientSchema } from "@rstreamlabs/rstream/client";
export type { Client } from "@rstreamlabs/rstream/client";

export const listedClientSchema = clientSchema.partial();

export const clientFilterSchema = clientSchema
  .pick({
    id: true,
    status: true,
    user_id: true,
    agent: true,
    channel: true,
    version: true,
    os: true,
    arch: true,
    protocol_version: true,
    labels: true,
  })
  .partial();

export const listClientsParamsSchema = z.object({
  limit: z.number().int().min(1).optional(),
  filters: clientFilterSchema.optional(),
});

export const listClientsResponseSchema = z.array(listedClientSchema);

export type ListedClient = z.infer<typeof listedClientSchema>;

export type ClientFilter = z.infer<typeof clientFilterSchema>;

export type ListClientsParams = z.infer<typeof listClientsParamsSchema>;

export type ListClientsResponse = z.infer<typeof listClientsResponseSchema>;
