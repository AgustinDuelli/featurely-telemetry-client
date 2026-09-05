import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
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
      "@featurely/telemetry-client/react: useTelemetryClient() called outside of a <TelemetryProvider>",
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
