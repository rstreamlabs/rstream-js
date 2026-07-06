// See LICENSE file in the project root for license information.

import { formatTunnelHost } from "./tunnel";
import * as z from "zod";
import type { Tunnel } from "@rstreamlabs/rstream/tunnel";

const osFamilySchema = z.enum([
  "linux",
  "macos",
  "windows",
  "netbsd",
  "openbsd",
  "freebsd",
]);

const webttyCapabilitySchema = z.enum(["exec", "fs"]);

const webttyFSModeSchema = z.enum(["read-write", "read-only"]);

const webttyEncryptionPolicySchema = z.enum([
  "disabled",
  "explicit_key",
  "workspace_managed",
]);

type WebTTYCapability = z.infer<typeof webttyCapabilitySchema>;

export const webttyServerSchema = z.object({
  tunnel_id: z.string(),
  tunnel_name: z.string().optional(),
  target: z.string().optional(),
  rstream_url: z.string().optional(),
  status: z.string().optional(),
  publish: z.boolean().optional(),
  workspace_id: z.string().optional(),
  project_id: z.string().optional(),
  tunnel_protocol: z.enum(["http", "webtty"]),
  managed: z.boolean(),
  host: z.string(),
  token_auth: z.boolean(),
  server_id: z.string().optional(),
  server_name: z.string().optional(),
  host_key_id: z.string().optional(),
  e2e: z.enum(["disabled", "required"]).optional(),
  client_proof: z.enum(["none", "required"]).optional(),
  encryption_policy: webttyEncryptionPolicySchema.optional(),
  capabilities: z.array(webttyCapabilitySchema).optional(),
  exec_path: z.string().optional(),
  fs_path: z.string().optional(),
  fs_mode: webttyFSModeSchema.optional(),
  os_family: osFamilySchema.optional(),
  arch: z.string().optional(),
  os_id: z.string().optional(),
  os_version_id: z.string().optional(),
  os_version_codename: z.string().optional(),
  os_pretty_name: z.string().optional(),
  kernel_release: z.string().optional(),
  hostname: z.string().optional(),
  labels: z.record(z.string(), z.string().optional()).optional(),
});

export type WebTTYServer = z.infer<typeof webttyServerSchema>;

function isWebTTYCapability(value: string): value is WebTTYCapability {
  return webttyCapabilitySchema.safeParse(value).success;
}

function parseWebTTYCapabilities(
  value: string | undefined,
): WebTTYCapability[] {
  const values = (value ?? "")
    .split(",")
    .map((capability) => capability.trim())
    .filter(isWebTTYCapability);
  return webttyCapabilitySchema.options.filter((capability) =>
    values.includes(capability),
  );
}

function webTTYCapabilitiesForLabels(
  labels: Record<string, string | undefined>,
): WebTTYCapability[] {
  const parsed = parseWebTTYCapabilities(labels["rstream.webtty.capabilities"]);
  return parsed.length > 0 ? parsed : ["exec"];
}

function webTTYHasCapability(
  capabilities: WebTTYCapability[],
  capability: WebTTYCapability,
): boolean {
  return capabilities.includes(capability);
}

function parser(tunnel: Tunnel): WebTTYServer | null {
  if (tunnel.status !== "online") return null;
  if (tunnel.publish !== true) return null;
  const managedProtocol = tunnel.protocol === "webtty";
  if (tunnel.protocol !== "http" && !managedProtocol) return null;
  const tunnelLabels = tunnel.labels ?? {};
  if (
    !managedProtocol &&
    tunnelLabels["application-protocol"] !== "rstream.webtty"
  ) {
    return null;
  }
  const capabilities = webTTYCapabilitiesForLabels(tunnelLabels);
  const labels: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(tunnelLabels)) {
    if (!key.startsWith("rstream.webtty.label.")) continue;
    const labelKey = key.slice("rstream.webtty.label.".length);
    if (labelKey.length === 0) continue;
    labels[labelKey] = value;
  }
  const name = (tunnel.name ?? "").trim();
  const serverId = (tunnelLabels["rstream.webtty.server_id"] ?? "").trim();
  const serverName = (tunnelLabels["rstream.webtty.server_name"] ?? "").trim();
  const target = serverName || name || tunnel.id;
  const rstreamTarget = serverId || name || tunnel.id;
  const candidate: Record<string, unknown> = {
    tunnel_id: tunnel.id,
    tunnel_name: name || undefined,
    target,
    rstream_url: `rstrm://${rstreamTarget}`,
    status: tunnel.status,
    publish: tunnel.publish === true,
    workspace_id: tunnel.workspace_id,
    project_id: tunnel.project_id,
    tunnel_protocol: tunnel.protocol,
    managed: managedProtocol,
    host: formatTunnelHost(tunnel),
    token_auth: tunnel.token_auth === true,
    server_id: serverId || undefined,
    server_name: serverName || undefined,
    host_key_id: tunnelLabels["rstream.webtty.host_key_id"],
    e2e: tunnelLabels["rstream.webtty.e2e"],
    client_proof: tunnelLabels["rstream.webtty.client_proof"],
    encryption_policy: tunnelLabels["rstream.webtty.encryption_policy"],
    capabilities,
    exec_path: webTTYHasCapability(capabilities, "exec")
      ? (tunnelLabels["rstream.webtty.exec.path"] ?? "/")
      : undefined,
    fs_path: webTTYHasCapability(capabilities, "fs")
      ? (tunnelLabels["rstream.webtty.fs.path"] ?? "/fs")
      : undefined,
    fs_mode: webTTYHasCapability(capabilities, "fs")
      ? (tunnelLabels["rstream.webtty.fs.mode"] ?? "read-write")
      : undefined,
    os_family: tunnelLabels["rstream.webtty.os_family"],
    arch: tunnelLabels["rstream.webtty.arch"],
    os_id: tunnelLabels["rstream.webtty.os_id"],
    os_version_id: tunnelLabels["rstream.webtty.os_version_id"],
    os_version_codename: tunnelLabels["rstream.webtty.os_version_codename"],
    os_pretty_name: tunnelLabels["rstream.webtty.os_pretty_name"],
    kernel_release: tunnelLabels["rstream.webtty.kernel_release"],
    hostname: tunnelLabels["rstream.webtty.hostname"],
    labels: Object.keys(labels).length > 0 ? labels : undefined,
  };
  const parsed = webttyServerSchema.safeParse(candidate);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseWebTTYServers(tunnels: Tunnel[]): WebTTYServer[] {
  return tunnels
    .map((tunnel) => parser(tunnel))
    .filter((server): server is WebTTYServer => server !== null);
}
