"use client";

import { useCallback } from "react";
import type { ButtonHTMLAttributes } from "react";
import { WebTTYWorkspace } from "@rstreamlabs/terminal-ui";
import type { WebTTYConnection } from "@rstreamlabs/terminal-ui";
import "@xterm/xterm/css/xterm.css";
import "@rstreamlabs/terminal-ui/theme.css";

function Button({
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "outline" }) {
  return <button type="button" data-variant={variant} {...props} />;
}

export function TerminalWorkspace() {
  const prepareSession = useCallback(
    async (signal: AbortSignal): Promise<WebTTYConnection> => {
      const response = await fetch("/api/terminal/session", {
        method: "POST",
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Terminal authorization failed.");
      const value: unknown = await response.json();
      if (
        value === null ||
        typeof value !== "object" ||
        !("url" in value) ||
        typeof value.url !== "string" ||
        !("transport" in value) ||
        value.transport !== "websocket"
      )
        throw new Error("Invalid terminal authorization response.");
      return { url: value.url, transport: value.transport };
    },
    [],
  );
  return (
    <WebTTYWorkspace
      Button={Button}
      prepareSession={prepareSession}
      onPreparationError={() => window.alert("Terminal authorization failed.")}
      style={{ height: 400 }}
    />
  );
}
