// See LICENSE file in the project root for license information.

"use client";

import { useRstream } from "../hooks/use-rstream";
import * as React from "react";
import type { UseRstreamOptions } from "../hooks/use-rstream";

type RstreamContextValue = ReturnType<typeof useRstream>;

const RstreamContext = React.createContext<RstreamContextValue | undefined>(
  undefined,
);

export function useRstreamContext() {
  const ctx = React.useContext(RstreamContext);
  if (!ctx)
    throw new Error("useRstreamContext must be used within a RstreamProvider");
  return ctx;
}

interface RstreamProviderProps {
  options?: UseRstreamOptions;
  children?: React.ReactNode;
}

export function RstreamProvider({ options, children }: RstreamProviderProps) {
  const { error, tunnels, clients } = useRstream(options);
  const value = React.useMemo(
    () => ({ error, tunnels, clients }),
    [error, tunnels, clients],
  );
  const content = isRenderProp(children) ? children(value) : children;
  return (
    <RstreamContext.Provider value={value}>{content}</RstreamContext.Provider>
  );
}

function isRenderProp(
  children: React.ReactNode | ((value: RstreamContextValue) => React.ReactNode),
): children is (value: RstreamContextValue) => React.ReactNode {
  return typeof children === "function";
}
