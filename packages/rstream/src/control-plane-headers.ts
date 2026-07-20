// See LICENSE file in the project root for license information.

import * as z from "zod";

export type ControlPlaneHeaders = Readonly<Record<string, string>>;

const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const headersSchema = z.record(z.string(), z.string());
const reservedHeaders = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function canonicalHeaderName(name: string): string {
  return name
    .split("-")
    .map(
      (part) =>
        `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join("-");
}

export function normalizeControlPlaneHeaders(
  headers?: ControlPlaneHeaders,
): ControlPlaneHeaders {
  const normalizedNames = new Set<string>();
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => {
      const normalizedName = name.trim();
      const lowerName = normalizedName.toLowerCase();
      if (!headerNamePattern.test(normalizedName))
        throw new Error(`Invalid control plane header name "${name}".`);
      if (
        reservedHeaders.has(lowerName) ||
        lowerName.startsWith("x-forwarded-")
      )
        throw new Error(`Reserved control plane header "${name}".`);
      if (/\r|\n/.test(value))
        throw new Error(`Invalid value for control plane header "${name}".`);
      const canonicalName = canonicalHeaderName(normalizedName);
      if (normalizedNames.has(canonicalName))
        throw new Error(`Duplicate control plane header "${canonicalName}".`);
      normalizedNames.add(canonicalName);
      return [canonicalName, value];
    }),
  );
}

export function mergeControlPlaneHeaders(
  ...sources: (ControlPlaneHeaders | undefined)[]
): ControlPlaneHeaders {
  return Object.fromEntries(
    sources.flatMap((source) =>
      Object.entries(normalizeControlPlaneHeaders(source)),
    ),
  );
}

export function parseControlPlaneHeaders(value?: string): ControlPlaneHeaders {
  const normalized = value?.trim();
  if (!normalized) return {};
  const parsed: unknown = parseControlPlaneHeadersJSON(normalized);
  return normalizeControlPlaneHeaders(headersSchema.parse(parsed));
}

function parseControlPlaneHeadersJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error("Invalid RSTREAM_CONTROL_PLANE_HEADERS JSON.", {
      cause: error,
    });
  }
}
