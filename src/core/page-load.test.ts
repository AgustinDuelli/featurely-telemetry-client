import { describe, expect, it, vi } from "vitest";
import { createTelemetryClient, type WireEvent, type WireEventBatch } from "./client.js";
import { createPageLoadTracker } from "./page-load.js";

function setup() {
  const bodies: WireEventBatch[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string) as WireEventBatch);
    return new Response(null, { status: 202 });
  }) as unknown as typeof fetch;
  const client = createTelemetryClient({
    endpoint: "https://telemetry.example.com/ingest/events",
    apiKey: "k",
    serviceName: "featurely-web",
    environment: "production",
    batch: { maxSize: 100, flushIntervalMs: 60_000 },
    fetchImpl,
  });
  // Events exported so far, in delivery order.
  async function exported(): Promise<WireEvent[]> {
    await client.flush();
    return bodies.flatMap((b) => b.events);
  }
  return { client, exported };
}

describe("createPageLoadTracker", () => {
  it("emits each query as a child span of the page root, in the same trace", async () => {
    const { client, exported } = setup();
    const page = createPageLoadTracker(client, "page.load.feed");

    page.startQuery("feed.posts").end();
    page.startQuery("feed.leaderboard").end();

    const events = await exported();
    const root = events.find((e) => e.name === "page.load.feed")!;
    const posts = events.find((e) => e.name === "feed.posts")!;
    const leaderboard = events.find((e) => e.name === "feed.leaderboard")!;

    expect(posts.parent_span_id).toBe(root.span_id);
    expect(leaderboard.parent_span_id).toBe(root.span_id);
    expect(posts.trace_id).toBe(root.trace_id);
    expect(leaderboard.trace_id).toBe(root.trace_id);
    expect(root.parent_span_id).toBeNull();
  });

  it("ends the page root only once every started query has ended", async () => {
    const { client, exported } = setup();
    const page = createPageLoadTracker(client, "page.load.feed");

    const posts = page.startQuery("feed.posts");
    const leaderboard = page.startQuery("feed.leaderboard");

    posts.end();
    expect((await exported()).map((e) => e.name)).toEqual(["feed.posts"]);

    leaderboard.end();
    expect((await exported()).map((e) => e.name)).toEqual([
      "feed.posts",
      "feed.leaderboard",
      "page.load.feed",
    ]);
  });

  it("ignores a second end() of the same query", async () => {
    const { client, exported } = setup();
    const page = createPageLoadTracker(client, "page.load.feed");

    const posts = page.startQuery("feed.posts");
    const leaderboard = page.startQuery("feed.leaderboard");
    posts.end();
    posts.end();

    // The duplicate end must not release the root while the leaderboard is pending.
    expect((await exported()).map((e) => e.name)).toEqual(["feed.posts"]);
    leaderboard.end();
  });
});
