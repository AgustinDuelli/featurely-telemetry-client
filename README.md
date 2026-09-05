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
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

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

### Convex

```ts
import { createConvexEmitter } from "@agustinduelli/telemetry-client/convex";

const convexEmitter = createConvexEmitter(telemetry);

export const emit = internalAction({
  handler: async (_ctx, args: { name: string; tenantId: string; attributes: Record<string, string | number | boolean | null> }) => {
    await convexEmitter.emitBusinessEvent(args.name, args.tenantId, args.attributes);
  },
});
```

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
