// See LICENSE file in the project root for license information.

import { parseControlPlaneHeaders } from "./control-plane-headers";
import type { ControlPlaneHeaders } from "./control-plane-headers";

export const DEFAULT_API_URL = "https://rstream.io";

export interface RstreamEnvironmentSettings {
  apiUrl?: string;
  controlPlaneHeaders: ControlPlaneHeaders;
  engine?: string;
  region?: string;
  token?: string;
}

function trimOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function readEnvironmentVariable(name: string): string | undefined {
  return typeof process === "undefined" ? undefined : process.env[name];
}

export function readEnvironment(): RstreamEnvironmentSettings {
  return {
    apiUrl: trimOptionalString(readEnvironmentVariable("RSTREAM_API_URL")),
    controlPlaneHeaders: parseControlPlaneHeaders(
      readEnvironmentVariable("RSTREAM_CONTROL_PLANE_HEADERS"),
    ),
    engine: trimOptionalString(readEnvironmentVariable("RSTREAM_ENGINE")),
    region: trimOptionalString(readEnvironmentVariable("RSTREAM_REGION")),
    token: trimOptionalString(
      readEnvironmentVariable("RSTREAM_AUTHENTICATION_TOKEN"),
    ),
  };
}

export function resolveAPIURL(apiUrl?: string): string {
  return (
    trimOptionalString(apiUrl) ?? readEnvironment().apiUrl ?? DEFAULT_API_URL
  );
}
