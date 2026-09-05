/**
 * Internal queue + flush-by-size-or-interval logic shared by the core client.
 *
 * Mirrors pipeline stage 7 ("Batching, 5s / 100 eventos") from
 * `pipeline-telemetria.md` on the client side: the client itself batches
 * before sending, so a burst of spans/events does not become one HTTP
 * request per event.
 */

export interface BatchOptions {
  /** Max items held before an automatic flush is triggered. Default: 100. */
  maxSize: number;
  /** Max time (ms) an item can sit in the queue before an automatic flush. Default: 5000. */
  flushIntervalMs: number;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  maxSize: 100,
  flushIntervalMs: 5000,
};

export type FlushHandler<T> = (items: T[]) => void | Promise<void>;

/**
 * A minimal, dependency-free batching queue.
 *
 * - `add()` enqueues an item; if the queue reaches `maxSize` it flushes
 *   immediately (size-triggered flush).
 * - A timer flushes automatically every `flushIntervalMs`, even if the
 *   queue never reaches `maxSize` (interval-triggered flush).
 * - `flush()` can be called manually (e.g. on `TelemetryClient.flush()`)
 *   and resets the interval timer.
 */
export class BatchQueue<T> {
  private readonly options: BatchOptions;
  private readonly onFlush: FlushHandler<T>;
  private queue: T[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Tracks in-flight flush promises so `dispose()`/`flush()` can await them. */
  private pending: Promise<void>[] = [];

  constructor(onFlush: FlushHandler<T>, options: Partial<BatchOptions> = {}) {
    this.onFlush = onFlush;
    this.options = {
      maxSize: options.maxSize ?? DEFAULT_BATCH_OPTIONS.maxSize,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULT_BATCH_OPTIONS.flushIntervalMs,
    };
    this.startTimer();
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushIntervalMs);
    // Do not keep the Node process alive solely because of this timer.
    const maybeUnref = (this.timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === "function") {
      maybeUnref.call(this.timer);
    }
  }

  add(item: T): void {
    this.queue.push(item);
    if (this.queue.length >= this.options.maxSize) {
      void this.flush();
    }
  }

  /** Drains the current queue and hands it to the flush handler. Safe to call when empty (no-op). */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    const result = Promise.resolve(this.onFlush(batch));
    this.pending.push(result);
    try {
      await result;
    } finally {
      this.pending = this.pending.filter((p) => p !== result);
    }
  }

  /** Stops the interval timer and flushes any remaining items. */
  async dispose(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.flush();
    await Promise.all(this.pending);
  }

  get size(): number {
    return this.queue.length;
  }
}
