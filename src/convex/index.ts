import type { TelemetryClient } from "../core/index.js";

export interface ConvexEmitter {
  emitBusinessEvent(
    name: string,
    tenantId: string,
    attributes: Record<string, string | number | boolean | null>,
  ): Promise<void>;
}

/**
 * Thin delegation to `client.recordEvent`, exactly as fixed in
 * `modelo-datos.md` Parte 3. Reused by the 13 Convex mutations that emit
 * business events, via the project's own delgado `internalAction`
 * (`convex/telemetry.ts`) — Convex requires actions to be registered in the
 * calling project, so that registration cannot live in this library.
 */
export function createConvexEmitter(client: TelemetryClient): ConvexEmitter {
  return {
    async emitBusinessEvent(
      name: string,
      tenantId: string,
      attributes: Record<string, string | number | boolean | null>,
    ): Promise<void> {
      await client.recordEvent("business_event", name, attributes, tenantId);
    },
  };
}
