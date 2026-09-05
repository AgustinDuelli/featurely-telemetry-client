/**
 * W3C Trace Context-compatible ID generation.
 *
 * - trace_id: 16 bytes, rendered as 32 lowercase hex chars.
 * - span_id: 8 bytes, rendered as 16 lowercase hex chars.
 *
 * Spec: https://www.w3.org/TR/trace-context/#trace-id
 *
 * Portability note: this must work in both browser and Node/Convex runtimes.
 * `crypto.getRandomValues` is available in browsers, Node >= 15 (via the
 * global `crypto` object, stable since Node 19 / available as
 * `globalThis.crypto` in modern runtimes) and the Convex runtime (a V8
 * isolate exposing standard Web Crypto). We avoid `crypto.randomUUID()`
 * directly because a UUID is 128 bits with fixed version/variant bits
 * (not fully random) and formatted with dashes — using
 * `getRandomValues` gives us exact byte control for both ID lengths
 * without depending on Node-only APIs like `node:crypto`.
 */

function getWebCrypto(): Crypto {
  const g = globalThis as { crypto?: Crypto };
  if (!g.crypto || typeof g.crypto.getRandomValues !== "function") {
    throw new Error(
      "@agustinduelli/telemetry-client: no Web Crypto API available in this runtime (expected globalThis.crypto.getRandomValues)",
    );
  }
  return g.crypto;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  getWebCrypto().getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Generates a 32-lowercase-hex-char trace ID (128 bits), W3C-compatible. */
export function generateTraceId(): string {
  return randomHex(16);
}

/** Generates a 16-lowercase-hex-char span ID (64 bits), W3C-compatible. */
export function generateSpanId(): string {
  return randomHex(8);
}

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;

export function isValidTraceId(value: string): boolean {
  return TRACE_ID_PATTERN.test(value) && value !== "0".repeat(32);
}

export function isValidSpanId(value: string): boolean {
  return SPAN_ID_PATTERN.test(value) && value !== "0".repeat(16);
}
