import { describe, expect, it, vi } from "vitest";
import { createTelemetryClient, type WireEventBatch } from "./client.js";

function makeMockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("createTelemetryClient", () => {
  it("throws when serviceName is missing", () => {
    expect(() =>
      createTelemetryClient({
        endpoint: "https://telemetry.example.com/ingest/events",
        apiKey: "k",
        serviceName: "",
        environment: "development",
      }),
    ).toThrow(/serviceName is required/);
  });

  it("recordEvent builds a wire-format batch with service_name at the batch level, not per-event", async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const client = createTelemetryClient({
      endpoint: "https://telemetry.example.com/ingest/events",
      apiKey: "test-key",
      serviceName: "featurely-web",
      environment: "production",
      batch: { maxSize: 100, flushIntervalMs: 60_000 },
      fetchImpl,
    });

    await client.recordEvent(
      "business_event",
      "post.created",
      { postId: "abc123" },
      "project-slug",
    );
    await client.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://telemetry.example.com/ingest/events");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");

    const body = JSON.parse(init.body as string) as WireEventBatch;
    expect(body.service_name).toBe("featurely-web");
    expect(body.environment).toBe("production");
    expect(body.events).toHaveLength(1);

    const event = body.events[0]!;
    expect(event.type).toBe("business_event");
    expect(event.name).toBe("post.created");
    expect(event.tenant_id).toBe("project-slug");
    expect(event.attributes).toEqual({ postId: "abc123" });
    expect(event.trace_id).toMatch(/^[0-9a-f]{32}$/);
    // service_name must NOT appear on the per-event object, only on the batch envelope.
    expect(event).not.toHaveProperty("service_name");

    await client.flush();
  });

  it("rejects business_event without tenantId", async () => {
    const { fetchImpl } = makeMockFetch();
    const client = createTelemetryClient({
      endpoint: "https://telemetry.example.com/ingest/events",
      apiKey: "test-key",
      serviceName: "featurely-web",
      environment: "development",
      fetchImpl,
    });

    await expect(client.recordEvent("business_event", "post.created", {})).rejects.toThrow(
      /tenantId is required/,
    );
  });

  it("allows a log event without tenantId", async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const client = createTelemetryClient({
      endpoint: "https://telemetry.example.com/v1/traces",
      apiKey: "test-key",
      serviceName: "featurely-web",
      environment: "development",
      batch: { maxSize: 100, flushIntervalMs: 60_000 },
      fetchImpl,
    });

    await client.recordEvent("log", "debug.message", { detail: "x" });
    await client.flush();

    const body = JSON.parse(calls[0]!.init.body as string) as WireEventBatch;
    expect(body.events[0]!.type).toBe("log");
    expect(body.events[0]!.tenant_id).toBeUndefined();
  });

  it("startSpan/end produces a span event with duration and W3C-valid ids", async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const client = createTelemetryClient({
      endpoint: "https://telemetry.example.com/v1/traces",
      apiKey: "test-key",
      serviceName: "featurely-web",
      environment: "development",
      batch: { maxSize: 1, flushIntervalMs: 60_000 },
      fetchImpl,
    });

    const span = client.startSpan("user.click.createPost");
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    span.setAttribute("projectId", "p1");
    span.setStatus("OK");
    span.end();

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(calls[0]!.init.body as string) as WireEventBatch;
    const event = body.events[0]!;
    expect(event.type).toBe("span");
    expect(event.trace_id).toBe(span.traceId);
    expect(event.span_id).toBe(span.spanId);
    expect(event.status).toBe("OK");
    expect(typeof event.duration_ms).toBe("number");
  });

  it("sends x-api-key by default (authScheme omitted)", async () => {
    const { fetchImpl, calls } = makeMockFetch();
    const client = createTelemetryClient({
      endpoint: "https://telemetry.example.com/v1/traces",
      apiKey: "browser-key",
      serviceName: "featurely-web",
      environment: "production",
      batch: { maxSize: 100, flushIntervalMs: 60_000 },
      fetchImpl,
    });

    await client.recordEvent("log", "debug.message");
    await client.flush();

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("browser-key");
    expect(headers.authorization).toBeUndefined();
  });

  it("sends Authorization: Bearer when authScheme is 'bearer', never x-api-key", async () => {
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

    await client.recordEvent("business_event", "post.created", {}, "project-slug");
    await client.flush();

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer convex-key");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("never throws when the underlying fetch rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const client = createTelemetryClient({
      endpoint: "https://telemetry.example.com/ingest/events",
      apiKey: "test-key",
      serviceName: "featurely-web",
      environment: "development",
      fetchImpl,
    });

    await client.recordEvent("log", "debug.message");
    await expect(client.flush()).resolves.toBeUndefined();
  });
});
