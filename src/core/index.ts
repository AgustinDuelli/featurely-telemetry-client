export {
  createTelemetryClient,
  type TelemetryClient,
  type TelemetryClientConfig,
  type Span,
  type SpanStatus,
  type RecordEventType,
  type WireEvent,
  type WireEventBatch,
} from "./client.js";
export { generateTraceId, generateSpanId, isValidTraceId, isValidSpanId } from "./trace-id.js";
export { BatchQueue, DEFAULT_BATCH_OPTIONS, type BatchOptions, type FlushHandler } from "./batching.js";
