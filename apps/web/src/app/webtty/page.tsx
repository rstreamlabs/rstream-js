// See LICENSE file in the project root for license information.

"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as React from "react";
import dynamic from "next/dynamic";

const WebTTYTerminal = dynamic(
  () => import("@rstreamlabs/react").then((mod) => mod.WebTTYTerminal),
  {
    ssr: false,
  },
);

function WebTTY({
  url,
  onConnect,
  onError,
  onComplete,
}: {
  url: string;
  onConnect?: () => void;
  onError: (msg: string) => void;
  onComplete: (code: number) => void;
}) {
  return (
    <WebTTYTerminal
      // WebTTY props
      url={url}
      envVars={[{ key: "TERM", value: "xterm-256color" }]}
      interactive={true}
      allocateTty={true}
      // xterm.js theme and options
      terminalOptions={{
        cursorBlink: true,
        fontSize: 14,
        theme: {
          foreground: "#000000",
          background: "#ffffff",
          cursor: "#000000",
          selectionBackground: "rgba(0, 0, 0, 0.3)",
          selectionForeground: "#000000",
        },
      }}
      // Event callbacks
      onConnect={onConnect}
      onError={onError}
      onComplete={onComplete}
    />
  );
}

export default function Page() {
  const [input, setInput] = React.useState<string>("ws://localhost:8080");
  const [connected, setConnected] = React.useState<boolean>(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [mounted, setMounted] = React.useState(false);
  const log = React.useCallback((message: string) => {
    setLogs((prevLogs) => [
      ...prevLogs,
      `[${new Date().toISOString()}] ${message}`,
    ]);
  }, []);
  const onConnect = React.useCallback(() => {
    setConnected(true);
  }, []);
  const onError = React.useCallback(
    (msg: string) => {
      log(`An error occurred: ${msg}`);
      setConnected(false);
    },
    [log],
  );
  const onComplete = React.useCallback(
    (code: number) => {
      log(`Remote command finished with code ${code}.`);
      setConnected(false);
    },
    [log],
  );
  React.useEffect(() => {
    if (connected) {
      log(`Connected to ${url}.`);
    }
  }, [connected, url, log]);
  React.useEffect(() => {
    setMounted(true);
  }, []);
  return (
    <div className="py-12">
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-foreground text-balance">
          Web Remote Terminal
        </h1>
        <div className="text-md text-muted-foreground">
          Connect to a remote WebTTY server and interact with a terminal session
          in your browser.
        </div>
        <div className="text-md text-muted-foreground">
          To get started, run a WebTTY server (for example using
          rstream-rtty-server):
        </div>
        <pre className="font-mono text-sm bg-muted p-2 rounded">
          rstream webtty server -v
        </pre>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ws://localhost:8080"
            disabled={connected}
          />
          <Button
            onClick={() => {
              setNonce((n) => n + 1);
              setUrl(input);
            }}
            disabled={connected}
            className="whitespace-nowrap"
          >
            Connect
          </Button>
        </div>
        <div className="border p-4 rounded-lg overflow-auto h-[200px]">
          <div className="space-y-2">
            {logs.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Waiting for logs...{" "}
              </div>
            ) : (
              logs.map((l, index) => (
                <pre
                  key={index}
                  className="font-mono text-xs text-muted-foreground whitespace-pre-wrap"
                >
                  {l}
                </pre>
              ))
            )}
          </div>
        </div>
        <div className="border p-4 rounded-lg overflow-auto h-[500px]">
          {mounted && url && (
            <WebTTY
              key={`webtty-${nonce}`}
              url={url}
              onConnect={onConnect}
              onError={onError}
              onComplete={onComplete}
            />
          )}
          {!mounted || (!connected && !url) ? (
            <div className="text-sm text-muted-foreground">
              Not connected. Set an url and click{" "}
              <span className="font-medium">Connect</span>.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
