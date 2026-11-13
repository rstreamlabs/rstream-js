// See LICENSE file in the project root for license information.

import * as z from "zod";
import { authTokenResourcesSchema } from "./auth-token";
import { credentialOwnerSchema } from "./credential-owner";
import { credentialSubjectIdSchema } from "./credential-owner";

export const whoamiSchema = z.object({
  id: z.string(),
  role: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

export type Whoami = z.infer<typeof whoamiSchema>;

const callerIdentityCommonSchema = {
  authExpiresAt: z.string().datetime().optional(),
  credentialId: credentialSubjectIdSchema.optional(),
  name: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  resources: authTokenResourcesSchema.optional(),
};

export const callerIdentitySchema = z.union([
  z
    .object({
      ...callerIdentityCommonSchema,
      owner: credentialOwnerSchema.options[0],
      role: z.string(),
      email: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...callerIdentityCommonSchema,
      owner: credentialOwnerSchema.options[1],
      credentialId: credentialSubjectIdSchema,
      permissions: z.array(z.string()),
    })
    .strict(),
]);

export type CallerIdentity = z.infer<typeof callerIdentitySchema>;

// Older servers ignore the explicit identity format and return the historical
// personal response. Never fall back when an explicit owner is malformed.
export function parseCallerIdentity(response: unknown): CallerIdentity {
  if (typeof response === "object" && response !== null && "owner" in response)
    return callerIdentitySchema.parse(response);
  const personal = whoamiSchema.parse(response);
  return callerIdentitySchema.parse({
    owner: { kind: "user", userId: personal.id },
    role: personal.role,
    name: personal.name,
    email: personal.email,
    permissions: personal.permissions,
  });
}
