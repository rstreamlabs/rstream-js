// See LICENSE file in the project root for license information.

import * as z from "zod";

export const tunnelsProjectSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  endpoint: z.string(),
  url: z
    .string()
    .describe("Deprecated. Use 'domain' and 'enginePort' instead."),
  domain: z.string(),
  enginePort: z.number().int().min(1).max(65535),
  turnPort: z.number().int().min(1).max(65535),
  turnsPort: z.number().int().min(1).max(65535),
  status: z.string(),
  provider: z.string(),
  region: z.string().optional(),
  plan: z.string(),
  deployment: z.string(),
});

export const listTunnelsProjectsParamsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  sort: z
    .enum(["id", "name", "endpoint", "status", "plan", "deployment"])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export const listTunnelsProjectsResponseSchema = z.object({
  projects: z.array(tunnelsProjectSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type TunnelsProject = z.infer<typeof tunnelsProjectSchema>;

export type ListTunnelsProjectsParams = z.infer<
  typeof listTunnelsProjectsParamsSchema
>;

export type ListTunnelsProjectsResponse = z.infer<
  typeof listTunnelsProjectsResponseSchema
>;

export function getTunnelsProjectEngine(
  project: TunnelsProject,
): string | undefined {
  if (project.endpoint && project.domain) {
    const enginePort = project.enginePort > 0 ? project.enginePort : 443;
    return `${project.endpoint}.${project.domain}:${enginePort}`;
  }
  if (project.url) {
    return project.url.includes(":") ? project.url : `${project.url}:443`;
  }
  return undefined;
}
