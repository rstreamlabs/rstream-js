// See LICENSE file in the project root for license information.

"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import { getXtermTheme } from "./theme.js";

/** Shared xterm lifecycle. Transport and permissions belong to the host adapter. */
export function TerminalSurface({
  active,
  terminalOptions,
  onTerminalCreated,
  onData,
  onResize,
  onTitleChange,
  onError,
}: {
  active: boolean;
  terminalOptions?: import("@xterm/xterm").ITerminalOptions;
  onTerminalCreated: (terminal: Terminal) => void;
  onData: (data: string) => void;
  onResize: (size: { rows: number; cols: number }) => void;
  onTitleChange: (title: string) => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const initialOptions = useRef(terminalOptions);
  const created = useEffectEvent(onTerminalCreated);
  const input = useEffectEvent(onData);
  const resize = useEffectEvent(onResize);
  const title = useEffectEvent(onTitleChange);
  const failed = useEffectEvent(onError);
  useEffect(() => {
    let disposed = false;
    const resources = { dispose() {} };
    Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-unicode11"),
      import("@xterm/addon-web-links"),
      import("@xterm/addon-webgl"),
    ])
      .then(
        ([
          { Terminal },
          { FitAddon },
          { Unicode11Addon },
          { WebLinksAddon },
          { WebglAddon },
        ]) => {
          if (disposed || !container.current) return;
          const display = new Terminal({
            allowProposedApi: true,
            cursorBlink: false,
            disableStdin: true,
            convertEol: true,
            scrollback: 200000,
            fontSize: 14,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            theme: getXtermTheme(),
            ...initialOptions.current,
          });
          terminal.current = display;
          // Even partial initialization must release the display.
          resources.dispose = () => display.dispose();
          const fitAddon = new FitAddon();
          display.loadAddon(fitAddon);
          display.loadAddon(new WebLinksAddon());
          display.loadAddon(new Unicode11Addon());
          display.open(container.current);
          try {
            display.loadAddon(new WebglAddon());
          } catch {
            /* Canvas renderer remains available. */
          }
          const fit = () => {
            if (
              !container.current?.clientWidth ||
              !container.current.clientHeight
            )
              return;
            try {
              fitAddon.fit();
            } catch {
              /* A hidden tab is fitted when visible. */
            }
          };
          const observer = new ResizeObserver(fit);
          observer.observe(container.current);
          const themeObserver = new MutationObserver(() => {
            display.options.theme = getXtermTheme();
          });
          themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "style"],
          });
          const dataSubscription = display.onData(input);
          const resizeSubscription = display.onResize(resize);
          const titleSubscription = display.onTitleChange(title);
          resources.dispose = () => {
            observer.disconnect();
            themeObserver.disconnect();
            dataSubscription.dispose();
            resizeSubscription.dispose();
            titleSubscription.dispose();
            display.dispose();
          };
          fit();
          created(display);
        },
      )
      .catch(() => {
        resources.dispose();
        resources.dispose = () => {};
        terminal.current = null;
        if (!disposed)
          failed(
            "The terminal display could not load. Reload this page to retry.",
          );
      });
    return () => {
      disposed = true;
      terminal.current = null;
      resources.dispose();
    };
  }, []);
  useEffect(() => {
    if (active && terminal.current && !terminal.current.options.disableStdin)
      terminal.current.focus();
  }, [active]);
  return (
    <div
      ref={container}
      className="h-full min-h-0 w-full overflow-hidden"
      aria-label="Remote terminal output"
    />
  );
}
