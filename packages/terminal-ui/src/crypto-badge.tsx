"use client";

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { ShieldCheck } from "lucide-react";
import type { ComponentProps } from "react";
export type TerminalCryptoState = "closed" | "failed" | "pending" | "verified";
export type TerminalCryptoInfo = {
  payloadKeyId?: Uint8Array;
  payloadCipher: string;
  payloadTagBits: number;
  keyAgreement: string;
};
const classes = (...values: string[]) => values.join(" ");
const HoverCard = HoverCardPrimitive.Root;
const HoverCardTrigger = HoverCardPrimitive.Trigger;
function HoverCardContent({
  className,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        {...props}
        className={`z-50 rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ${className}`}
      />
    </HoverCardPrimitive.Portal>
  );
}
function formatSessionId(bytes?: Uint8Array) {
  if (!bytes?.byteLength) return null;
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return value.length <= 20
    ? value
    : `${value.slice(0, 12)}...${value.slice(-8)}`;
}
export function TerminalCryptoBadge({
  info,
  state,
}: {
  info: TerminalCryptoInfo | null;
  state: "closed" | "failed" | "pending" | "verified";
}) {
  const verified = state === "verified";
  const sessionId = formatSessionId(info?.payloadKeyId);
  const title =
    state === "verified"
      ? "End-to-end encrypted"
      : state === "closed"
        ? "Secure session ended"
        : state === "failed"
          ? "Secure session not established"
          : "Secure session starting";
  const body =
    state === "verified"
      ? "This session uses mutual authentication between the browser and the remote device. Terminal input and output are end-to-end encrypted."
      : state === "closed"
        ? "This session used authenticated end-to-end encryption. Terminal data was protected until the connection closed."
        : state === "failed"
          ? "Authenticated end-to-end encryption was required, but mutual verification did not complete. Review the server identity and authorized client identity, then reconnect."
          : "Mutual authentication is being established before terminal data is opened.";
  return (
    <HoverCard closeDelay={100} openDelay={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={title}
          aria-disabled={!verified}
          className={classes(
            "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
            verified
              ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-50"
              : state === "failed"
                ? "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-50"
                : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-[min(calc(100vw-2rem),20rem)] p-3"
        side="left"
        sideOffset={8}
      >
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
        {info ? (
          <dl className="mt-3 grid grid-cols-[6.75rem_1fr] gap-x-3 gap-y-1 text-xs leading-5">
            {sessionId ? (
              <>
                <dt className="text-muted-foreground">Session</dt>
                <dd className="font-medium text-foreground">{sessionId}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Payload</dt>
            <dd className="font-medium text-foreground">
              {info.payloadCipher}, {info.payloadTagBits}-bit tag
            </dd>
            <dt className="text-muted-foreground">Handshake</dt>
            <dd className="font-medium text-foreground">
              Mutual endpoint proof
            </dd>
            <dt className="text-muted-foreground">Key exchange</dt>
            <dd className="font-medium text-foreground">{info.keyAgreement}</dd>
          </dl>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
