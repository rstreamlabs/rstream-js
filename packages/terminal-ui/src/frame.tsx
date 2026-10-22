// See LICENSE file in the project root for license information.

"use client";

import {
  useId,
  type ReactNode,
  type ComponentType,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
} from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ExternalLink, Loader2, Plus, X } from "lucide-react";

export type TerminalStatus =
  "idle" | "connecting" | "connected" | "error" | "completed" | "disconnected";
export type TerminalTab = { id: string; title: string; status: TerminalStatus };
const dot: Record<TerminalStatus, string> = {
  idle: "bg-zinc-400",
  connecting: "bg-amber-500",
  connected: "bg-emerald-500",
  error: "bg-red-500",
  completed: "bg-zinc-400",
  disconnected: "bg-zinc-400",
};
type Control = ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "outline" }
>;

/** rstream dashboard WebTTY chrome, controlled by the product's session adapter.
 * Inactive panels stay mounted; switching tabs must never recreate a session. */
export function TerminalFrame({
  tabs,
  activeTabId,
  onActiveTabChange,
  onNewTab,
  onCloseTab,
  onFullscreen,
  adding = false,
  newTabDisabled = false,
  displayOnly = false,
  renderTab,
  toolbar,
  empty,
  className = "",
  Button,
  containerProps,
}: {
  tabs: readonly TerminalTab[];
  activeTabId: string | null;
  onActiveTabChange?: (id: string) => void;
  onNewTab?: () => void;
  onCloseTab?: (id: string) => void;
  onFullscreen?: () => void;
  adding?: boolean;
  newTabDisabled?: boolean;
  displayOnly?: boolean;
  renderTab: (tab: TerminalTab, active: boolean) => ReactNode;
  toolbar?: ReactNode;
  empty?: ReactNode;
  className?: string;
  Button: Control;
  containerProps?: Omit<
    HTMLAttributes<HTMLDivElement>,
    "className" | "children"
  >;
}) {
  const id = useId();
  return (
    <div
      {...containerProps}
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background ${className}`}
    >
      <div className="p-2 border-b">
        <div className="flex space-x-2">
          <Tabs.Root
            value={activeTabId ?? ""}
            onValueChange={onActiveTabChange}
            className="min-w-0 flex-1 overflow-x-auto no-scrollbar"
          >
            <Tabs.List
              aria-label="Terminal sessions"
              className="flex justify-start gap-2 bg-transparent p-0 h-auto"
            >
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="group relative flex-[1_1_0] min-w-[80px]"
                >
                  <Tabs.Trigger
                    value={tab.id}
                    id={`${id}-tab-${tab.id}`}
                    aria-controls={`${id}-panel-${tab.id}`}
                    disabled={displayOnly}
                    className="flex h-8 w-full items-center gap-2 rounded-lg justify-between py-0 pl-2 pr-8 text-xs font-medium border bg-primary-foreground text-muted-foreground data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-lg ${dot[tab.status]}`}
                      aria-label={tab.status}
                    />
                    <span className="truncate">{tab.title}</span>
                  </Tabs.Trigger>
                  {onCloseTab && !displayOnly && (
                    <button
                      type="button"
                      aria-label={`Close ${tab.title}`}
                      title="Close tab"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onCloseTab(tab.id)}
                      className="absolute right-1 top-1 rounded-md p-1 text-muted-foreground transition-opacity hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </Tabs.List>
          </Tabs.Root>
          <Button
            type="button"
            aria-label="New terminal"
            title="New tab"
            className="h-8 shrink-0 rounded-md px-2"
            variant="outline"
            aria-busy={adding}
            disabled={
              !onNewTab ||
              newTabDisabled ||
              displayOnly ||
              tabs.length >= 5 ||
              adding
            }
            onClick={onNewTab}
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
          {onFullscreen && (
            <Button
              type="button"
              aria-label="Open fullscreen"
              title="Open fullscreen"
              className="h-8 shrink-0 rounded-md px-2"
              variant="outline"
              onClick={onFullscreen}
              disabled={displayOnly}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
          {toolbar}
        </div>
      </div>
      <div className="h-0 min-h-0 flex-1 overflow-hidden p-2">
        <div className="relative h-full w-full overflow-hidden">
          {tabs.map((tab) => {
            const active = activeTabId === tab.id;
            return (
              <div
                key={tab.id}
                id={`${id}-panel-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`${id}-tab-${tab.id}`}
                aria-hidden={!active}
                inert={!active}
                className={`absolute inset-0 h-full w-full transition-opacity duration-100 ${active ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
              >
                {renderTab(tab, active)}
              </div>
            );
          })}
          {!tabs.length && empty}
        </div>
      </div>
    </div>
  );
}
