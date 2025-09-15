// See LICENSE file in the project root for license information.

import { filters, select } from "./zod";
import { tunnelSchema } from "./tunnel";
import * as z from "zod";
import type { JwtPayload } from "jsonwebtoken";

export const createShortTermTokenParamsSchema = z.object({
  expires_in: z.number().default(60), // 1 minute
  permissions: z.object({
    // Permissions for creating a tunnel
    create: z
      .union([
        z.boolean(),
        z.object({
          filters: filters(tunnelSchema).optional(),
        }),
      ])
      .optional(),
    // Permissions for connecting to a tunnel
    connect: z
      .union([
        z.boolean(),
        z.object({
          filters: filters(tunnelSchema).optional(),
          params: filters(z.object({
            path: z.string().optional(),
          })).optional(),
        }),
      ])
      .optional(),
    // Permissions for listing tunnels
    list: z
      .union([
        z.boolean(),
        z.object({
          filters: filters(tunnelSchema).optional(),
          select: select(tunnelSchema).optional(),
        }),
      ])
      .optional(),
  }),
  // Additional metadata
  metadata: z.unknown().optional(),
});

export const createShortTermTokenResponseSchema = z.object({
  token: z.string(),
});

export type CreateShortTermTokenParams = z.infer<
  typeof createShortTermTokenParamsSchema
>;

export type CreateShortTermTokenResponse = z.infer<
  typeof createShortTermTokenResponseSchema
>;

export interface RstreamAuth {
  token: () => Promise<string>;
}

export const rstreamAuthPayloadSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("pat"),
    }),
    z.object({
      type: z.literal("app"),
      clientId: z.string(),
    }),
  ])
  .and(
    z.object({
      metadata: z
        .object({
          engine: z.string().optional(),
          permissions:
            createShortTermTokenParamsSchema.shape.permissions.optional(),
        })
        .optional(),
    }),
  );

export type RstreamAuthPayload = z.infer<typeof rstreamAuthPayloadSchema>;

export type RstreamAuthJwtPayload = JwtPayload & RstreamAuthPayload;
