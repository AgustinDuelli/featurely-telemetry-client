import { describe, expect, it } from "vitest";
import { generateSpanId, generateTraceId, isValidSpanId, isValidTraceId } from "./trace-id.js";

describe("trace-id", () => {
  it("generates a 32-lowercase-hex-char trace id", () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(isValidTraceId(id)).toBe(true);
  });

  it("generates a 16-lowercase-hex-char span id", () => {
    const id = generateSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(isValidSpanId(id)).toBe(true);
  });

  it("generates distinct ids across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateTraceId()));
    expect(ids.size).toBe(50);
  });

  it("rejects the all-zero trace id as invalid (W3C reserved value)", () => {
    expect(isValidTraceId("0".repeat(32))).toBe(false);
  });

  it("rejects the all-zero span id as invalid (W3C reserved value)", () => {
    expect(isValidSpanId("0".repeat(16))).toBe(false);
  });

  it("rejects malformed ids (wrong length or uppercase)", () => {
    expect(isValidTraceId("abc")).toBe(false);
    expect(isValidTraceId("A".repeat(32))).toBe(false);
    expect(isValidSpanId("abc")).toBe(false);
  });
});
