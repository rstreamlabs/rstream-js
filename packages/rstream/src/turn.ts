// See LICENSE file in the project root for license information.

import * as z from "zod";

export const turnCredentialsSchema = z.object({
  username: z.string(),
  credential: z.string(),
  urls: z.array(z.string().url()),
  ttl: z.number().int().min(1).max(3600),
});

export const createTurnCredentialsParamsSchema = z
  .object({
    ttlSeconds: z.number().int().min(1).max(3600).optional(),
  })
  .strict();

export type CreateTurnCredentialsParams = z.infer<
  typeof createTurnCredentialsParamsSchema
>;

export type TURNCredentials = z.infer<typeof turnCredentialsSchema>;
