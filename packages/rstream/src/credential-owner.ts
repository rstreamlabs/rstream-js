// See LICENSE file in the project root for license information.

import * as z from "zod";

export const credentialSubjectIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, {
    message: "Identity references must not contain surrounding whitespace.",
  });

export const credentialOwnerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("user"),
      userId: credentialSubjectIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("workspace"),
      workspaceId: credentialSubjectIdSchema,
    })
    .strict(),
]);

export type CredentialOwner = z.infer<typeof credentialOwnerSchema>;

export function credentialOwnerFromColumns(columns: {
  userId?: string | null;
  ownerWorkspaceId?: string | null;
}): CredentialOwner | null {
  const { userId, ownerWorkspaceId } = columns;
  const input =
    userId != null && ownerWorkspaceId == null
      ? { kind: "user", userId }
      : userId == null && ownerWorkspaceId != null
        ? { kind: "workspace", workspaceId: ownerWorkspaceId }
        : null;
  const result = credentialOwnerSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function credentialOwnersEqual(
  left: CredentialOwner,
  right: CredentialOwner,
): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "user" && right.kind === "user"
    ? left.userId === right.userId
    : left.kind === "workspace" && right.kind === "workspace"
      ? left.workspaceId === right.workspaceId
      : false;
}
