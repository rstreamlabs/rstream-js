// See LICENSE file in the project root for license information.

import { abortError } from "./errors";

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Waiter<T>[] = [];
  private closeError: Error | undefined;

  public push(value: T): boolean {
    if (this.closeError !== undefined) return false;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.cleanup();
      waiter.resolve(value);
      return true;
    }
    this.values.push(value);
    return true;
  }

  public shift(signal?: AbortSignal): Promise<T> {
    if (this.values.length > 0) {
      const value = this.values.shift();
      if (value !== undefined) return Promise.resolve(value);
    }
    if (this.closeError !== undefined) return Promise.reject(this.closeError);
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortError());
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const waiter: Waiter<T> = { cleanup, reject, resolve };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  public close(error: Error, dispose?: (value: T) => void): void {
    if (this.closeError !== undefined) return;
    this.closeError = error;
    const values = this.values.splice(0);
    const waiters = this.waiters.splice(0);
    if (dispose !== undefined) for (const value of values) dispose(value);
    for (const waiter of waiters) {
      waiter.cleanup();
      waiter.reject(error);
    }
  }
}
