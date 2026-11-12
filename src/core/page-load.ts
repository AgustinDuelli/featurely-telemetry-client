import type { Span, TelemetryClient } from "./client.js";

export interface PageQueryHandle {
  /** Ends this query's span. Calling it more than once has no effect. */
  end(): void;
}

export interface PageLoadTracker {
  /** Root span of the page load; ends when every started query has ended. */
  readonly span: Span;
  /** Starts a child span of the page root for one critical query. */
  startQuery(name: string): PageQueryHandle;
}

/**
 * Groups the critical queries of one page into a single trace: a root span
 * (e.g. `page.load.publicFeed`) with one child span per query, so the trace
 * shows which resource was the bottleneck instead of a single total time.
 *
 * The root ends when the last query started so far ends, so every query of
 * the page must be started before the first one resolves -- true for queries
 * rendered in the same commit. A query mounted later, after all earlier ones
 * already resolved, is not part of the page load and would start a tracker
 * whose root has already closed.
 */
export function createPageLoadTracker(client: TelemetryClient, name: string): PageLoadTracker {
  const root = client.startSpan(name);
  let pending = 0;

  return {
    span: root,
    startQuery(queryName: string): PageQueryHandle {
      const child = client.startSpan(queryName, {
        parentSpanId: root.spanId,
        traceId: root.traceId,
      });
      pending += 1;
      let ended = false;
      return {
        end() {
          if (ended) return;
          ended = true;
          child.end();
          pending -= 1;
          if (pending === 0) root.end();
        },
      };
    },
  };
}
