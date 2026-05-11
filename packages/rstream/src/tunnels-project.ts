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

const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function normalizeDNSLabel(value: string, name: string): string {
  const normalized = value.trim().toLowerCase();
  if (!dnsLabelPattern.test(normalized)) {
    throw new Error(`${name} must be a valid DNS label.`);
  }
  return normalized;
}

function normalizeHostname(value: string, name: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > 253 ||
    normalized.includes("..") ||
    /[:/?#@\\\s]/.test(normalized)
  ) {
    throw new Error(`${name} must be a valid hostname.`);
  }
  const labels = normalized.split(".");
  if (
    labels.length === 0 ||
    !labels.every(
      (label) => label === "localhost" || dnsLabelPattern.test(label),
    )
  ) {
    throw new Error(`${name} must be a valid hostname.`);
  }
  return normalized;
}

function normalizeHostPort(value: string, defaultPort: number, name: string) {
  const normalized = value.trim();
  if (
    !normalized ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ||
    /[/?#@\\\s]/.test(normalized)
  ) {
    throw new Error(`${name} must be a host[:port] value.`);
  }
  const url = new URL(`https://${normalized}`);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be a host[:port] value.`);
  }
  const hostname = normalizeHostname(url.hostname, name);
  const port = url.port ? Number(url.port) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} port must be an integer between 1 and 65535.`);
  }
  return `${hostname}:${port}`;
}

export function getTunnelsProjectEngine(
  project: TunnelsProject,
): string | undefined {
  if (project.endpoint && project.domain) {
    const endpoint = normalizeDNSLabel(project.endpoint, "Project endpoint");
    const domain = normalizeHostname(project.domain, "Project domain");
    const enginePort = project.enginePort > 0 ? project.enginePort : 443;
    return `${endpoint}.${domain}:${enginePort}`;
  }
  if (project.url) {
    return normalizeHostPort(project.url, 443, "Project URL");
  }
  return undefined;
}
