import { describe, expect, it, vi } from "vitest";
import { createTelemetryClient, type WireEventBatch } from "../core/client.js";
import { createConvexEmitter } from "./index.js";

function makeMockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("createConvexEmitter", () => {
  it("flushes immediately after emitBusinessEvent, without waiting for the batch timer", async () => {
    // Regression test for a production incident (2026-09-08): a Convex
    // internalAction resolves as soon as recordEvent enqueues the event,
    // but Convex tears down the action's execution environment right
    // after that -- a batching timer set for later (the core client's
    // default 5000ms) never gets a chance to fire, so the event was
    // silently lost on every single invocation despite the action itself
    // reporting success. A long flushIntervalMs here proves the delivery
    // does NOT depend on the timer ever firing.
    const { fetchImpl, calls } = makeMockFetch();
    const client = createTelemetryClient({
      endpoint: "https://telemetry.example.com/ingest/events",
      apiKey: "convex-key",
      authScheme: "bearer",
      serviceName: "featurely-convex",
      environment: "production",
      batch: { maxSize: 100, flushIntervalMs: 60_000 },
      fetchImpl,
    });

    const emitter = createConvexEmitter(client);
    await emitter.emitBusinessEvent("post.created", "project-slug", { postId: "abc123" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(calls[0]!.init.body as string) as WireEventBatch;
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.name).toBe("post.created");

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer convex-key");
  });
});
