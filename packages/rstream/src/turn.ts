// See LICENSE file in the project root for license information.

import * as z from "zod";

export const turnCredentialsSchema = z.object({
  username: z.string().min(1).max(512),
  credential: z.string().min(1).max(1024),
  urls: z
    .array(
      z
        .string()
        .max(2048)
        .url()
        .refine((value) => /^(?:stun|stuns|turn|turns):[^\s]+$/.test(value)),
    )
    .min(1)
    .max(16),
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
