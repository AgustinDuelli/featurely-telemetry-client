import { describe, expect, it, vi } from "vitest";
import { BatchQueue } from "./batching.js";

describe("BatchQueue", () => {
  it("flushes automatically once maxSize is reached", async () => {
    const onFlush = vi.fn();
    const queue = new BatchQueue<number>(onFlush, { maxSize: 3, flushIntervalMs: 60_000 });

    queue.add(1);
    queue.add(2);
    expect(onFlush).not.toHaveBeenCalled();

    queue.add(3);
    // flush is fired-and-forgotten (async) from add(); let microtasks settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([1, 2, 3]);
    expect(queue.size).toBe(0);

    await queue.dispose();
  });

  it("flushes automatically at flushIntervalMs even below maxSize", async () => {
    vi.useFakeTimers();
    try {
      const onFlush = vi.fn();
      const queue = new BatchQueue<number>(onFlush, { maxSize: 100, flushIntervalMs: 5000 });

      queue.add(1);
      expect(onFlush).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(onFlush).toHaveBeenCalledWith([1]);

      await queue.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call the flush handler when the queue is empty", async () => {
    const onFlush = vi.fn();
    const queue = new BatchQueue<number>(onFlush, { maxSize: 10, flushIntervalMs: 60_000 });

    await queue.flush();

    expect(onFlush).not.toHaveBeenCalled();
    await queue.dispose();
  });

  it("manual flush() drains the queue immediately", async () => {
    const onFlush = vi.fn();
    const queue = new BatchQueue<string>(onFlush, { maxSize: 100, flushIntervalMs: 60_000 });

    queue.add("a");
    queue.add("b");
    await queue.flush();

    expect(onFlush).toHaveBeenCalledWith(["a", "b"]);
    expect(queue.size).toBe(0);

    await queue.dispose();
  });
});
