// See LICENSE file in the project root for license information.

"use client";

import * as React from "react";
import { TerminalFrame } from "./frame.js";
import { TerminalCryptoBadge } from "./crypto-badge.js";
import { WebTTYTerminal } from "./webtty-terminal.js";
import {
  normalizeWebTTYTerminalError,
  redactWebTTYConnectionCredentials,
} from "./webtty-errors.js";
import {
  describeWebTTYPayloadCrypto,
  webTTYCryptoBadgeState,
} from "./webtty-security.js";
import { getXtermTheme } from "./theme.js";
import type {
  WebTTYClientEndpointIdentity,
  WebTTYExpectedServerIdentity,
  WebTTYPayloadCrypto,
} from "@rstreamlabs/webtty";
import type { ITheme, Terminal } from "@xterm/xterm";
export type WebTTYClientSecurityConfig = {
  clientBrowserId?: string;
  clientCredential?: Uint8Array;
  clientDeviceId?: string;
  clientPrincipalId?: string;
  endpointIdentity?: WebTTYClientEndpointIdentity;
  expectsAuthenticatedE2E?: boolean;
  expectedServerIdentity?: WebTTYExpectedServerIdentity;
  payloadCrypto?: WebTTYPayloadCrypto;
};

export function useXtermTheme(): ITheme {
  const [xtermTheme, setXtermTheme] = React.useState<ITheme>(() =>
    typeof document === "undefined" ? {} : getXtermTheme(),
  );
  React.useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const target = document.documentElement;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          setXtermTheme(getXtermTheme());
          break;
        }
      }
    });
    observer.observe(target, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return xtermTheme;
}

export function WebTTYTab({
  url,
  transport,
  active = true,
  onConnect,
  onError,
  onComplete,
  onTerminal,
  onTitleChange,
  security,
  theme,
}: {
  url: string;
  transport?: "websocket" | "webtransport";
  active?: boolean;
  onConnect?: () => void;
  onError: (msg: string) => void;
  onComplete: (code: number) => void;
  onTerminal: (t: Terminal) => void;
  onTitleChange: (title: string) => void;
  security?: WebTTYClientSecurityConfig;
  theme: ITheme;
}) {
  const terminalRef = React.useRef<Terminal | null>(null);
  React.useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.theme = theme;
  }, [theme]);
  const formatError = React.useCallback(
    (message: string) =>
      normalizeWebTTYTerminalError(
        redactWebTTYConnectionCredentials(message, url),
        {
          hasClientEndpointIdentity: !!security?.endpointIdentity,
          hasExpectedServerIdentity: !!security?.expectedServerIdentity,
          expectsAuthenticatedE2E:
            !!security?.expectsAuthenticatedE2E ||
            !!security?.endpointIdentity ||
            !!security?.expectedServerIdentity ||
            !!security?.payloadCrypto,
        },
      ),
    [security, url],
  );
  const handleError = React.useCallback(
    (message: string) => {
      onError(formatError(message));
    },
    [formatError, onError],
  );
  return (
    <div className="h-full w-full overflow-hidden">
      <WebTTYTerminal
        url={url}
        transport={transport}
        active={active}
        envVars={[{ key: "TERM", value: "xterm-256color" }]}
        interactive
        allocateTty
        clientBrowserId={security?.clientBrowserId}
        clientCredential={security?.clientCredential}
        clientDeviceId={security?.clientDeviceId}
        clientPrincipalId={security?.clientPrincipalId}
        endpointIdentity={security?.endpointIdentity}
        expectedServerIdentity={security?.expectedServerIdentity}
        formatError={formatError}
        payloadCrypto={security?.payloadCrypto}
        terminalOptions={{
          allowProposedApi: true,
          convertEol: true,
          cursorBlink: false,
          fontSize: 14,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          scrollback: 200_000,
          theme,
        }}
        onConnect={onConnect}
        onError={handleError}
        onComplete={onComplete}
        onTerminalCreated={(t) => {
          terminalRef.current = t;
          onTerminal(t);
        }}
        onTitleChange={onTitleChange}
      />
    </div>
  );
}

export type TabStatus = "connecting" | "connected" | "error" | "completed";

export type WebTTYVisualTab = {
  id: string;
  title: string;
  status: TabStatus;
};

type WebTTYVisualState = {
  tabs: WebTTYVisualTab[];
  activeTabId: string | null;
  onActiveTabIdChange?: (tabId: string | null) => void;
  renderTab: (tab: WebTTYVisualTab) => React.ReactNode;
};

type TabModel = {
  id: string;
  security?: WebTTYClientSecurityConfig;
  title: string;
  url: string;
  transport: "websocket" | "webtransport";
  status: TabStatus;
  exitCode?: number;
};

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export type WebTTYConnection = WebTTYClientSecurityConfig & {
  url: string;
  transport: "websocket" | "webtransport";
};

/** Session controls extracted from the rstream dashboard. Products supply only
 * their authorization and fullscreen navigation, never terminal state policy. */
export function WebTTYWorkspace({
  prepareSession,
  onFullscreen,
  onPreparationError,
  terminalBlockedMessage,
  visualState,
  displayOnly,
  children,
  className,
  Button,
  ...props
}: {
  prepareSession?: (signal: AbortSignal) => Promise<WebTTYConnection>;
  onFullscreen?: () => void;
  onPreparationError: (message: string) => void;
  terminalBlockedMessage?: string | null;
  visualState?: WebTTYVisualState;
  displayOnly?: boolean;
  Button: React.ComponentProps<typeof TerminalFrame>["Button"];
} & React.HTMLAttributes<HTMLDivElement>) {
  const xtermTheme = useXtermTheme();
  const [tabs, setTabs] = React.useState<TabModel[]>([]);
  const [activeTabId, setActiveTabId] = React.useState<string | null>(null);
  const [isAddingTab, setIsAddingTab] = React.useState(false);
  const counterRef = React.useRef<number>(1);
  const termsRef = React.useRef<Record<string, Terminal | null>>({});
  const activeTabIdRef = React.useRef<string | null>(null);
  const tabsRef = React.useRef(tabs);
  const initialAttemptRef = React.useRef(false);
  const pendingRef = React.useRef<{
    controller: AbortController;
    automatic: boolean;
  } | null>(null);
  const hasVisualState = !!visualState;
  const updateTabs = React.useCallback(
    (update: (current: TabModel[]) => TabModel[]) => {
      tabsRef.current = update(tabsRef.current);
      setTabs(tabsRef.current);
    },
    [],
  );
  const selectTab = React.useCallback((id: string | null) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);
  const preparationErrorRef = React.useRef(onPreparationError);
  React.useLayoutEffect(() => {
    preparationErrorRef.current = onPreparationError;
  }, [onPreparationError]);
  const addTab = React.useCallback(
    async (automatic = false) => {
      if (
        !prepareSession ||
        hasVisualState ||
        displayOnly ||
        terminalBlockedMessage ||
        pendingRef.current ||
        tabsRef.current.length >= 5
      )
        return;
      const pending = { controller: new AbortController(), automatic };
      pendingRef.current = pending;
      setIsAddingTab(true);
      try {
        const resolved = await prepareSession(pending.controller.signal);
        // Providers may not support cancellation. Never use their late result.
        if (pending.controller.signal.aborted) return;
        const id = uid();
        updateTabs((current) => [
          ...current,
          {
            id,
            security: resolved,
            title: `Terminal ${counterRef.current++}`,
            url: resolved.url,
            transport: resolved.transport,
            status: "connecting",
          },
        ]);
        selectTab(id);
      } catch (err) {
        if (!pending.controller.signal.aborted) {
          preparationErrorRef.current(
            redactWebTTYConnectionCredentials(
              err instanceof Error
                ? err.message
                : "Failed to open terminal tab. Please try again.",
            ),
          );
        }
      } finally {
        if (pendingRef.current === pending) {
          pendingRef.current = null;
          setIsAddingTab(false);
        }
      }
    },
    [
      prepareSession,
      terminalBlockedMessage,
      hasVisualState,
      displayOnly,
      updateTabs,
      selectTab,
    ],
  );
  React.useEffect(() => {
    if (!prepareSession) initialAttemptRef.current = false;
    if (
      prepareSession &&
      !hasVisualState &&
      !displayOnly &&
      !terminalBlockedMessage &&
      !initialAttemptRef.current &&
      tabsRef.current.length === 0
    ) {
      initialAttemptRef.current = true;
      void addTab(true);
    }
    return () => {
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        pending.controller.abort();
        setIsAddingTab(false);
        // StrictMode and changed authorization must be able to retry the initial tab.
        if (pending.automatic) initialAttemptRef.current = false;
      }
    };
  }, [
    prepareSession,
    hasVisualState,
    displayOnly,
    terminalBlockedMessage,
    addTab,
  ]);
  const closeTab = React.useCallback(
    (id: string) => {
      const current = tabsRef.current;
      const index = current.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      const next = current.filter((tab) => tab.id !== id);
      updateTabs(() => next);
      if (activeTabIdRef.current === id) {
        selectTab((next[index] ?? next[index - 1])?.id ?? null);
      }
      delete termsRef.current[id];
    },
    [selectTab, updateTabs],
  );
  const setStatus = React.useCallback(
    (id: string, status: TabStatus, exitCode?: number) => {
      updateTabs((current) =>
        current.map((tab) =>
          tab.id === id ? { ...tab, status, exitCode } : tab,
        ),
      );
    },
    [updateTabs],
  );
  React.useEffect(() => {
    if (hasVisualState) return;
    if (!activeTabId) return;
    const t = termsRef.current[activeTabId];
    if (!t) return;
    const id = activeTabId;
    const handle = window.setTimeout(() => {
      if (activeTabIdRef.current === id) t.focus();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [activeTabId, hasVisualState]);
  const renderedTabs = hasVisualState ? visualState.tabs : tabs;
  const renderedActiveTabId = hasVisualState
    ? visualState.activeTabId
    : activeTabId;
  const activeTab = hasVisualState
    ? null
    : tabs.find((tab) => tab.id === renderedActiveTabId);
  const activeCryptoInfo =
    activeTab?.status === "connected" || activeTab?.status === "completed"
      ? describeWebTTYPayloadCrypto(activeTab.security?.payloadCrypto)
      : null;
  const activeCryptoBadgeState = activeTab
    ? webTTYCryptoBadgeState(activeTab.status, activeTab.security)
    : null;
  return (
    <TerminalFrame
      containerProps={props}
      Button={Button}
      tabs={renderedTabs}
      activeTabId={renderedActiveTabId}
      className={
        className ?? (hasVisualState ? "h-full" : "h-[calc(100dvh-8rem)]")
      }
      displayOnly={!!displayOnly && !hasVisualState}
      adding={isAddingTab}
      newTabDisabled={!prepareSession || !!terminalBlockedMessage}
      onActiveTabChange={
        hasVisualState
          ? (id) => visualState.onActiveTabIdChange?.(id)
          : selectTab
      }
      onNewTab={
        hasVisualState || displayOnly
          ? undefined
          : () => {
              void addTab();
            }
      }
      onCloseTab={hasVisualState || displayOnly ? undefined : closeTab}
      onFullscreen={onFullscreen}
      toolbar={
        <>
          {activeCryptoBadgeState ? (
            <TerminalCryptoBadge
              info={activeCryptoInfo}
              state={activeCryptoBadgeState}
            />
          ) : null}
          {children}
        </>
      }
      renderTab={(visualTab, active) => {
        if (hasVisualState) {
          const tab = visualState.tabs.find(
            (entry) => entry.id === visualTab.id,
          );
          return tab ? visualState.renderTab(tab) : null;
        }
        const tab = tabs.find((entry) => entry.id === visualTab.id);
        if (!tab) return null;
        return (
          <WebTTYTab
            url={tab.url}
            transport={tab.transport}
            active={active}
            onConnect={() => setStatus(tab.id, "connected")}
            onError={() => setStatus(tab.id, "error")}
            onComplete={(code) => setStatus(tab.id, "completed", code)}
            security={tab.security}
            theme={xtermTheme}
            onTerminal={(terminal) => {
              termsRef.current[tab.id] = terminal;
              if (tab.id === activeTabIdRef.current)
                window.setTimeout(() => {
                  if (activeTabIdRef.current === tab.id) terminal.focus();
                }, 0);
            }}
            onTitleChange={(title) =>
              updateTabs((prev) =>
                prev.map((entry) => {
                  const nextTitle = title.trim();
                  return entry.id === tab.id &&
                    nextTitle &&
                    nextTitle !== entry.title
                    ? { ...entry, title: nextTitle }
                    : entry;
                }),
              )
            }
          />
        );
      }}
    />
  );
}
