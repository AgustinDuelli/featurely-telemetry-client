import { createContext, createElement, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Span, TelemetryClient } from "../core/index.js";

const TelemetryContext = createContext<TelemetryClient | null>(null);

export interface TelemetryProviderProps {
  client: TelemetryClient;
  children: ReactNode;
}

/**
 * Wraps a `TelemetryClient` instance in a React context so `useTelemetryClient`
 * and `useSpan` can access it without prop drilling. Mount once, near the
 * root layout, configured with `serviceName: "featurely-web"` (or the
 * consuming app's own service name).
 */
export function TelemetryProvider({ client, children }: TelemetryProviderProps) {
  return createElement(TelemetryContext.Provider, { value: client }, children);
}

/** Returns the `TelemetryClient` instance provided by the nearest `TelemetryProvider`. */
export function useTelemetryClient(): TelemetryClient {
  const client = useContext(TelemetryContext);
  if (!client) {
    throw new Error(
      "@agustinduelli/telemetry-client/react: useTelemetryClient() called outside of a <TelemetryProvider>",
    );
  }
  return client;
}

/**
 * Starts a span scoped to `name`. Returns the same `Span` instance across
 * re-renders of the component (memoized on the client + name), so callers
 * can call `span.setAttribute(...)` / `span.end()` from event handlers,
 * e.g. wrapping a Convex mutation call (Level 1 instrumentation).
 */
export function useSpan(name: string): Span {
  const client = useTelemetryClient();
  return useMemo(() => client.startSpan(name), [client, name]);
}

/**
 * Level 2 instrumentation (`specs/modelo-datos.md`, "Adaptador `/react` —
 * Nivel 2"): wraps a Convex `useQuery` call to measure time from first
 * subscription to first non-`undefined` result — the "first load" latency
 * of a critical query — without instrumenting the reactive re-executions
 * that follow. `queryFn` is expected to call `useQuery` (or similar)
 * internally; calling it unconditionally on every render, at this fixed
 * point in `useInstrumentedQuery`'s own body, keeps hook call order
 * stable across renders, satisfying the Rules of Hooks.
 *
 * Level 3 aggregation (re-execution count) is folded in here rather than
 * as a separate hook: once the first-result span closes, further changes
 * to `result` are counted as re-executions and reported as a single
 * `type=metric` event on unmount, named `<name>.requery_count`. Per-
 * re-execution latency (P50/P95/P99, per `specs/pipeline-telemetria.md`'s
 * Nivel 3) is NOT computed here — a reactive re-execution has no
 * client-observable start time to measure duration from (Convex delivers
 * the new value directly over the WebSocket), so only the count is
 * reported; latency percentiles are left as a Nivel 3 gap for a future
 * iteration if per-query timing becomes available.
 */
export function useInstrumentedQuery<T>(name: string, queryFn: () => T): T {
  const client = useTelemetryClient();
  const result = queryFn();

  const spanRef = useRef<Span | null>(null);
  const settledRef = useRef(false);
  const requeryCountRef = useRef(0);
  if (spanRef.current === null && !settledRef.current) {
    spanRef.current = client.startSpan(name);
  }

  useEffect(() => {
    if (!settledRef.current) {
      if (result !== undefined) {
        spanRef.current?.end();
        settledRef.current = true;
      }
      return;
    }
    requeryCountRef.current += 1;
  }, [result]);

  useEffect(() => {
    return () => {
      if (requeryCountRef.current > 0) {
        client.recordMetric(`${name}.requery_count`, requeryCountRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on unmount, reading the latest ref value at that point
  }, [client, name]);

  return result;
}
