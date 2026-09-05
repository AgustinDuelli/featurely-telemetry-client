import { BatchQueue, type BatchOptions } from "./batching.js";
import { generateSpanId, generateTraceId } from "./trace-id.js";

/** Configuration for `createTelemetryClient`. See `modelo-datos.md` Parte 3. */
export interface TelemetryClientConfig {
  /** URL of the telemetry service ingest endpoint (`POST /v1/traces` or `POST /ingest/events`). */
  endpoint: string;
  /** Sent as the `x-api-key` header, per contract C1. */
  apiKey: string;
  /**
   * Identifies the emitting application/product as an OTel `Resource`
   * (`service.name`), not as a span attribute. Required, no default —
   * see week-9 `service_name` generalization in `technical.md` Parte A.
   */
  serviceName: string;
  environment: "production" | "staging" | "development";
  /** Default: 100 events / 5000ms, aligned to pipeline stage 7. */
  batch?: Partial<BatchOptions>;
  /**
   * Fetch implementation to use for delivery. Defaults to `globalThis.fetch`.
   * Exposed mainly for testing (mock fetch, no real network calls).
   */
  fetchImpl?: typeof fetch;
}

export type SpanStatus = "OK" | "ERROR";

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: SpanStatus): void;
  end(): void;
}

export type RecordEventType = "log" | "business_event";

export interface TelemetryClient {
  startSpan(name: string, options?: { parentSpanId?: string; traceId?: string }): Span;
  withSpan<T>(name: string, fn: (span: Span) => T): T;
  recordMetric(name: string, value: number, attributes?: Record<string, string | number>): void;
  /**
   * `tenantId` is required for `type === "business_event"` (maps directly to
   * the `tenant_id` column of `analytics_events`, a top-level field, not
   * part of `attributes`); irrelevant/omittable for `"log"`.
   */
  recordEvent(
    type: RecordEventType,
    name: string,
    attributes?: Record<string, string | number | boolean | null>,
    tenantId?: string,
  ): Promise<void>;
  flush(): Promise<void>;
}

/** Wire-format event, matching the unified event schema from `pipeline-telemetria.md`. */
export interface WireEvent {
  source: "browser" | "convex";
  trace_id: string;
  span_id?: string;
  parent_span_id?: string | null;
  name: string;
  type: "span" | "metric" | "log" | "business_event";
  attributes?: Record<string, string | number | boolean | null>;
  duration_ms?: number;
  status?: SpanStatus;
  timestamp: number;
  environment?: string;
  tenant_id?: string;
}

/** Batch envelope POSTed to `endpoint`. `service_name` lives here, once per batch, not per event. */
export interface WireEventBatch {
  source: "browser" | "convex";
  environment: string;
  service_name: string;
  timestamp: number;
  events: WireEvent[];
}

function detectSource(): "browser" | "convex" {
  // Portable runtime check: `window` only exists in browsers. Convex's
  // V8-isolate runtime and Node both lack it, and both are non-browser
  // producers of telemetry from this client's point of view.
  return typeof window !== "undefined" ? "browser" : "convex";
}

class SpanImpl implements Span {
  readonly traceId: string;
  readonly spanId: string;
  private readonly name: string;
  private readonly parentSpanId: string | undefined;
  private readonly startedAt: number;
  private readonly attributes: Record<string, string | number | boolean> = {};
  private status: SpanStatus = "OK";
  private ended = false;
  private readonly onEnd: (event: WireEvent) => void;

  constructor(
    name: string,
    parentSpanId: string | undefined,
    traceId: string,
    onEnd: (event: WireEvent) => void,
  ) {
    this.name = name;
    this.parentSpanId = parentSpanId;
    this.traceId = traceId;
    this.spanId = generateSpanId();
    this.startedAt = Date.now();
    this.onEnd = onEnd;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  setStatus(status: SpanStatus): void {
    this.status = status;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    const durationMs = Date.now() - this.startedAt;
    this.onEnd({
      source: detectSource(),
      trace_id: this.traceId,
      span_id: this.spanId,
      parent_span_id: this.parentSpanId ?? null,
      name: this.name,
      type: "span",
      attributes: this.attributes,
      duration_ms: durationMs,
      status: this.status,
      timestamp: this.startedAt,
    });
  }
}

/** Concrete factory implementing `TelemetryClient`. */
export function createTelemetryClient(config: TelemetryClientConfig): TelemetryClient {
  if (!config.serviceName) {
    throw new Error("@agustinduelli/telemetry-client: config.serviceName is required");
  }
  if (!config.endpoint) {
    throw new Error("@agustinduelli/telemetry-client: config.endpoint is required");
  }

  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "@agustinduelli/telemetry-client: no fetch implementation available; pass config.fetchImpl explicitly",
    );
  }

  async function sendBatch(events: WireEvent[]): Promise<void> {
    if (events.length === 0) return;
    const body: WireEventBatch = {
      source: detectSource(),
      environment: config.environment,
      service_name: config.serviceName,
      timestamp: Date.now(),
      events,
    };
    try {
      await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Telemetry delivery must never throw into the caller's control flow
      // (an observability outage must not degrade the product) — same
      // principle already fixed for the server-side pipeline in
      // `pipeline-telemetria.md` ("Resiliencia del pipeline").
    }
  }

  const queue = new BatchQueue<WireEvent>(sendBatch, config.batch);

  function startSpan(name: string, options?: { parentSpanId?: string; traceId?: string }): Span {
    const traceId = options?.traceId ?? generateTraceId();
    return new SpanImpl(name, options?.parentSpanId, traceId, (event) => queue.add(event));
  }

  function withSpan<T>(name: string, fn: (span: Span) => T): T {
    const span = startSpan(name);
    try {
      const result = fn(span);
      if (result instanceof Promise) {
        return result
          .then((value) => {
            span.end();
            return value;
          })
          .catch((error) => {
            span.setStatus("ERROR");
            span.end();
            throw error;
          }) as unknown as T;
      }
      span.end();
      return result;
    } catch (error) {
      span.setStatus("ERROR");
      span.end();
      throw error;
    }
  }

  function recordMetric(
    name: string,
    value: number,
    attributes?: Record<string, string | number>,
  ): void {
    queue.add({
      source: detectSource(),
      trace_id: generateTraceId(),
      name,
      type: "metric",
      attributes: { value, ...(attributes ?? {}) },
      timestamp: Date.now(),
    });
  }

  async function recordEvent(
    type: RecordEventType,
    name: string,
    attributes?: Record<string, string | number | boolean | null>,
    tenantId?: string,
  ): Promise<void> {
    if (type === "business_event" && !tenantId) {
      throw new Error(
        "@agustinduelli/telemetry-client: tenantId is required when recordEvent type is 'business_event'",
      );
    }
    queue.add({
      source: detectSource(),
      trace_id: generateTraceId(),
      name,
      type,
      attributes,
      timestamp: Date.now(),
      tenant_id: tenantId,
    });
  }

  async function flush(): Promise<void> {
    await queue.flush();
  }

  return { startSpan, withSpan, recordMetric, recordEvent, flush };
}
