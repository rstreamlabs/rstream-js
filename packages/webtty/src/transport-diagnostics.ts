// See LICENSE file in the project root for license information.

export function getErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  if (error instanceof Error && error.name === "SecurityError") {
    return `The browser blocked the connection under its security policy. Check connect-src and browser restrictions.${message ? ` ${message}` : ""}`;
  }
  return message || "No diagnostic details were provided.";
}

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function credentialForms(value: string): string[] {
  const encoded = encodeURIComponent(value);
  const formEncoded = new URLSearchParams({ value }).toString().slice(6);
  return [value, encoded, formEncoded, encodeURIComponent(encoded)];
}

function credentialPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    escaped.replace(/%[\da-f]{2}/gi, (escape) =>
      escape.replace(
        /[a-f]/gi,
        (hex) => `[${hex.toLowerCase()}${hex.toUpperCase()}]`,
      ),
    ),
    "g",
  );
}

export function redactEndpointCredentials(
  message: string,
  endpoint: string | URL,
): string {
  try {
    const url = new URL(endpoint);
    const credentials = [
      ...url.searchParams.values(),
      decodeCredential(url.username),
      decodeCredential(url.password),
      decodeCredential(url.hash.slice(1)),
    ];
    const forms = [
      ...new Set(credentials.filter(Boolean).flatMap(credentialForms)),
    ].sort((a, b) => b.length - a.length);
    return forms.reduce(
      (redacted, value) =>
        redacted.replace(credentialPattern(value), "[redacted]"),
      message,
    );
  } catch {
    return "Connection failed: invalid endpoint URL.";
  }
}
