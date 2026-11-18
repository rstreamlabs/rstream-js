// See LICENSE file in the project root for license information.

export interface ICESelection {
  readonly id: string;
  readonly changes?: number;
}

function transportPair(value: unknown): ICESelection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("type" in value) || value.type !== "transport") return undefined;
  if (
    !("selectedCandidatePairId" in value) ||
    typeof value.selectedCandidatePairId !== "string"
  )
    return undefined;
  if (!value.selectedCandidatePairId) return undefined;
  const changes =
    "selectedCandidatePairChanges" in value &&
    typeof value.selectedCandidatePairChanges === "number" &&
    Number.isSafeInteger(value.selectedCandidatePairChanges) &&
    value.selectedCandidatePairChanges >= 0
      ? value.selectedCandidatePairChanges
      : undefined;
  return { id: value.selectedCandidatePairId, changes };
}

function firefoxPair(value: unknown): ICESelection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("type" in value) || value.type !== "candidate-pair") return undefined;
  if (!("selected" in value) || value.selected !== true) return undefined;
  if (!("id" in value) || typeof value.id !== "string") return undefined;
  return value.id ? { id: value.id } : undefined;
}

function selection(report: RTCStatsReport): ICESelection | undefined {
  const values: unknown[] = Array.from(report.values());
  return (
    values.map(transportPair).find((id) => id !== undefined) ??
    values.map(firefoxPair).find((id) => id !== undefined)
  );
}

/** Observe the selected pair without confusing a nominated or stale pair with selection. */
export function selectedICEPair(
  peer: RTCPeerConnection,
  signal: AbortSignal,
): Promise<ICESelection | undefined> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return peer.getStats();
      })
      .then(selection)
      .then(
        (current) => {
          signal.removeEventListener("abort", abort);
          resolve(current);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
    if (signal.aborted) abort();
  });
}

function selectionInterval(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, 50);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Keep restart cadence serialized until a new selected pair is visible or its existing budget ends. */
export async function waitForICESelection(
  peer: RTCPeerConnection,
  previous: ICESelection,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    signal.throwIfAborted();
    if (peer.connectionState === "closed" || peer.connectionState === "failed")
      throw new Error(
        "Filesystem WebRTC peer closed while waiting for ICE selection.",
      );
    const current = await selectedICEPair(peer, signal);
    signal.throwIfAborted();
    if (
      current &&
      (current.id !== previous.id ||
        (current.changes !== undefined &&
          previous.changes !== undefined &&
          current.changes > previous.changes))
    )
      return;
    await selectionInterval(signal);
  }
}
