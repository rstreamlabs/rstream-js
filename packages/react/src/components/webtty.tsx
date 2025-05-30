// See LICENSE file in the project root for license information.

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, ITerminalOptions, IDisposable } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  WebTTY,
  WebTTYClientConfig,
  WebTTYExecutionConfig,
  WebTTYEvents,
} from "@rstreamlabs/webtty";
import * as React from "react";

export interface WebTTYTerminalProps
  extends WebTTYClientConfig,
    WebTTYExecutionConfig,
    WebTTYEvents {
  /**
   * xterm.js TerminalOptions override
   */
  terminalOptions?: ITerminalOptions;
  /**
   * Called once the xterm Terminal is created (before connect).
   * Can be used to add your own add-ons or manipulate the Terminal instance.
   */
  onTerminalCreated?: (terminal: Terminal) => void;
}

/**
 * A React component that binds a WebTTY session to an xterm.js instance.
 */
export function WebTTYTerminal(props: WebTTYTerminalProps) {
  const {
    // WebTTY client config
    url,
    sendHeartbeat,
    heartbeatIntervalMs,
    // Execution config
    cmdArgs,
    envVars,
    allocateTty,
    interactive,
    username,
    workdir,
    // Events
    onStdout,
    onStdoutEos,
    onStderr,
    onStderrEos,
    onConnect,
    onComplete,
    onError,
    // xterm.js options
    terminalOptions,
    // Callbacks
    onTerminalCreated,
  } = props;
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!ref.current) {
      return;
    }
    let disposeOnData: IDisposable | null = null;
    let disposeOnResize: IDisposable | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const clear = () => {
      disposeOnData?.dispose();
      disposeOnData = null;
      disposeOnResize?.dispose();
      disposeOnResize = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: false,
      scrollback: 10000,
      ...terminalOptions,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new Unicode11Addon());
    try {
      terminal.loadAddon(new WebglAddon());
    } catch (err) {
      console.warn("WebGL addon could not be loaded:", err);
    }
    terminal.open(ref.current);
    onTerminalCreated?.(terminal);
    const webtty = new WebTTY(
      { url, sendHeartbeat, heartbeatIntervalMs },
      { cmdArgs, envVars, allocateTty, interactive, username, workdir },
      {
        onStdout: (chunk) => {
          onStdout?.(chunk);
          terminal.write(chunk);
        },
        onStdoutEos: () => {
          onStdoutEos?.();
        },
        onStderr: (chunk) => {
          onStderr?.(chunk);
          terminal.write(
            "\x1b[31m" + new TextDecoder().decode(chunk) + "\x1b[0m",
          );
        },
        onStderrEos: () => {
          onStderrEos?.();
        },
        onConnect: () => {
          onConnect?.();
          terminal.focus();
          try {
            webtty.resize(terminal.rows, terminal.cols);
          } catch (e) {
            console.error("Cannot resize remote TTY:", e);
          }
          disposeOnData = terminal.onData((data) => {
            try {
              webtty.writeStdin(new TextEncoder().encode(data));
            } catch (e) {
              console.error("Cannot writeStdin:", e);
            }
          });
          disposeOnResize = terminal.onResize((size) => {
            try {
              webtty.resize(size.rows, size.cols);
            } catch (e) {
              console.error("Cannot resize remote TTY:", e);
            }
          });
        },
        onComplete: (code) => {
          onComplete?.(code);
          terminal.write(`\r\nProcess exited with code ${code}\r\n`);
          clear();
        },
        onError: (err) => {
          onError?.(err);
          terminal.write(`\r\n[ERROR] ${err}\r\n`);
          clear();
        },
      },
    );
    webtty.connect();
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === ref.current) {
          fitAddon.fit();
        }
      }
    });
    resizeObserver.observe(ref.current);
    return () => {
      clear();
      terminal.dispose();
    };
  });
  return <div ref={ref} style={{ height: "100%", width: "100%" }} />;
}
