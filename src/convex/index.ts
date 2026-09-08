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
 *
 * Explicitly flushes after every event instead of relying on the core
 * client's batching timer: a Convex `internalAction` runs in a
 * short-lived, torn-down-on-return execution environment, so a queued
 * event waiting for the batch's size/interval trigger is silently lost —
 * the timer never gets a chance to fire once the action's handler promise
 * resolves. Found in production (2026-09-08): `telemetry:emit` completed
 * with no error on every invocation, yet zero requests ever reached
 * featurely-telemetry, because nothing had forced a flush before the
 * action returned.
 */
export function createConvexEmitter(client: TelemetryClient): ConvexEmitter {
  return {
    async emitBusinessEvent(
      name: string,
      tenantId: string,
      attributes: Record<string, string | number | boolean | null>,
    ): Promise<void> {
      await client.recordEvent("business_event", name, attributes, tenantId);
      await client.flush();
    },
  };
}
