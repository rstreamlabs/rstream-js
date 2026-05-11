// See LICENSE file in the project root for license information.

export const DEFAULT_API_URL = "https://rstream.io";

export interface RstreamEnvironmentSettings {
  apiUrl?: string;
  engine?: string;
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
    engine: trimOptionalString(readEnvironmentVariable("RSTREAM_ENGINE")),
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
