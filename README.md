# @agustinduelli/telemetry-client

Vendor-agnostic telemetry client for Featurely's observability pipeline. A
framework-free `core` (spans, metrics, business events, batching) plus two
optional adapters, `/react` and `/convex`, so consumers only pay for the
dependencies they actually use.

```
@agustinduelli/telemetry-client        # core: TelemetryClient, Span, createTelemetryClient
@agustinduelli/telemetry-client/react  # TelemetryProvider, useTelemetryClient, useSpan
@agustinduelli/telemetry-client/convex # createConvexEmitter
```

Published privately to GitHub Packages (`npm.pkg.github.com`), not the public
npm registry — see `.npmrc` / `.github/workflows/publish.yml`.

## Install

```
@agustinduelli:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
```

(`GH_PACKAGES_TOKEN`, not `GITHUB_PACKAGES_TOKEN` — GitHub Actions rejects any
secret name starting with the reserved `GITHUB_` prefix.)

```sh
bun add @agustinduelli/telemetry-client
```

## Usage

### Core

```ts
import { createTelemetryClient } from "@agustinduelli/telemetry-client";

const telemetry = createTelemetryClient({
  endpoint: "https://telemetry.example.com/v1/traces",
  apiKey: process.env.TELEMETRY_API_KEY!,
  serviceName: "featurely-web",
  environment: "production",
});

const span = telemetry.startSpan("user.click.createPost");
span.setAttribute("projectId", project.slug);
span.end();

await telemetry.recordEvent("business_event", "post.created", { postId }, project.slug);

// Optional 5th argument: join an existing trace instead of generating a new one
// (e.g. the traceId of the browser span that triggered this event).
await telemetry.recordEvent("business_event", "post.created", { postId }, project.slug, span.traceId);
```

### React

```tsx
import { TelemetryProvider, useSpan } from "@agustinduelli/telemetry-client/react";

function Root({ children }: { children: React.ReactNode }) {
  return <TelemetryProvider client={telemetry}>{children}</TelemetryProvider>;
}

function CreatePostButton() {
  const span = useSpan("user.click.createPost");
  // pass span.traceId as an explicit mutation argument to correlate
  // browser <-> Convex (WebSocket has no traceparent header propagation)
}
```

#### Page-load trace

```tsx
import { useInstrumentedQuery, usePageLoad } from "@agustinduelli/telemetry-client/react";

function FeedPage() {
  // Root span "page.load.feed" ends when every query below has resolved.
  const pageLoad = usePageLoad("page.load.feed");
  const posts = useInstrumentedQuery("feed.posts", () => useQuery(api.posts.list), { pageLoad });
  const top = useInstrumentedQuery("feed.leaderboard", () => useQuery(api.users.top), { pageLoad });
}
```

Each query is a child span of the root, in the same trace, so a trace viewer
shows which resource was the slowest. All queries of the page must mount in
the same commit as `usePageLoad`; the root closes when the last registered
query resolves.

### Convex

```ts
import { createTelemetryClient } from "@agustinduelli/telemetry-client";
import { createConvexEmitter } from "@agustinduelli/telemetry-client/convex";

const telemetry = createTelemetryClient({
  endpoint: "https://telemetry.example.com/ingest/events",
  apiKey: process.env.TELEMETRY_API_KEY!,
  authScheme: "bearer", // required -- the Convex ingest route validates
                        // Authorization: Bearer, not x-api-key (the
                        // browser route's scheme, and this option's default)
  serviceName: "featurely-convex",
  environment: "production",
});

const convexEmitter = createConvexEmitter(telemetry);

export const emit = internalAction({
  handler: async (_ctx, args: { name: string; tenantId: string; attributes: Record<string, string | number | boolean | null>; traceId?: string }) => {
    // traceId is optional: pass the browser span's traceId so the event joins its trace
    await convexEmitter.emitBusinessEvent(args.name, args.tenantId, args.attributes, args.traceId);
  },
});
```

`createConvexEmitter` flushes immediately after every event — it cannot
rely on the core client's batching timer, because a Convex
`internalAction`'s execution environment is torn down as soon as its
handler promise resolves, before a later timer would ever get a chance to
fire.

## Development

```sh
bun install
bun run build       # tsup, ESM+CJS per entrypoint (core/react/convex)
bun run typecheck   # tsc --noEmit
bun run test        # vitest
```

## Design references

Full design and rationale: `summaries/week-4/pipeline-telemetria-contratos-integracion/specs/modelo-datos.md`
(Parte 3) and `specs/pipeline-telemetria.md` in the thesis repo — unified
event schema, W3C trace correlation, batching policy (100 events / 5s).
