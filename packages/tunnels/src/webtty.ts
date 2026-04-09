// See LICENSE file in the project root for license information.

import * as z from "zod";
import type { Tunnel } from "./tunnel";

const osFamilies = [
  "linux",
  "macos",
  "windows",
  "netbsd",
  "openbsd",
  "freebsd",
] as const;

export const webttyServerSchema = z.object({
  tunnel_id: z.string(),
  host: z.string(),
  token_auth: z.boolean(),
  os_family: z.enum(osFamilies).optional(),
  arch: z.string().optional(),
  os_id: z.string().optional(), // /etc/os-release::ID (ubuntu, debian, rocky, etc.)
  os_version_id: z.string().optional(), // /etc/os-release::VERSION_ID (24.04, 22.04, 11, 10.0.19045, ...)
  os_version_codename: z.string().optional(), // /etc/os-release::VERSION_CODENAME (jammy, noble...)
  os_pretty_name: z.string().optional(), // /etc/os-release::PRETTY_NAME
  kernel_release: z.string().optional(), // uname -r
  hostname: z.string().optional(), // uname -n
  labels: z.record(z.string(), z.string().optional()).optional(),
});

export type WebTTYServer = z.infer<typeof webttyServerSchema>;

function parser(tunnel: Tunnel): WebTTYServer | null {
  if (tunnel.status !== "online") return null;
  if (tunnel.publish !== true) return null;
  if (tunnel.protocol !== "http") return null;
  const tunnelLabels = tunnel.labels ?? {};
  if (tunnelLabels["application-protocol"] !== "rstream.webtty") {
    return null;
  }
  const labels: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(tunnelLabels)) {
    if (!key.startsWith("rstream.webtty.label.")) continue;
    const labelKey = key.slice("rstream.webtty.label.".length);
    if (labelKey.length === 0) continue;
    labels[labelKey] = value;
  }
  const candidate: Record<string, unknown> = {
    tunnel_id: tunnel.id,
    host: tunnel.host,
    token_auth: tunnel.token_auth === true,
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
