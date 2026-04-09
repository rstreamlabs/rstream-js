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

export function readEnvironment(): RstreamEnvironmentSettings {
  return {
    apiUrl: trimOptionalString(process.env.RSTREAM_API_URL),
    engine: trimOptionalString(process.env.RSTREAM_ENGINE),
    token: trimOptionalString(process.env.RSTREAM_AUTHENTICATION_TOKEN),
  };
}

export function resolveAPIURL(apiUrl?: string): string {
  return (
    trimOptionalString(apiUrl) ?? readEnvironment().apiUrl ?? DEFAULT_API_URL
  );
}
