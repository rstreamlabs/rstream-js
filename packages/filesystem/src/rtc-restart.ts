// See LICENSE file in the project root for license information.

/** Serialize replacement while preserving authorization and consumer backpressure. */
export class ICERestartCadence {
  private restarted: number;
  private readonly interval: number;
  private readonly failed: (error: Error) => void;
  private readonly now: () => number;
  private waiting: number | null = null;
  private reading = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  public constructor(
    interval: number,
    failed: (error: Error) => void,
    now: () => number = () => performance.now(),
  ) {
    this.interval = interval;
    this.failed = failed;
    this.now = now;
    this.restarted = now();
  }
  public due(received: number, complete: boolean): boolean {
    this.progress(received, complete);
    return (
      this.waiting === null &&
      !complete &&
      this.now() - this.restarted >= this.interval
    );
  }
  public selected(received: number, complete: boolean): void {
    if (this.closed) return;
    this.restarted = this.now();
    this.waiting = complete ? null : received;
    this.arm();
  }
  public progress(received: number, complete: boolean): void {
    if (this.waiting === null || (received <= this.waiting && !complete))
      return;
    this.waiting = null;
    this.restarted = this.now();
    this.clear();
  }
  public demand(reading: boolean): void {
    if (this.reading === reading) return;
    this.reading = reading;
    if (reading) this.arm();
    else this.clear();
  }
  public close(): void {
    this.closed = true;
    this.waiting = null;
    this.clear();
  }
  private arm(): void {
    if (
      this.closed ||
      this.waiting === null ||
      !this.reading ||
      this.timer !== undefined
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.failed(
        new Error("Filesystem data did not resume after ICE restart."),
      );
    }, 20000);
  }
  private clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
