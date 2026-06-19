import type { PmoReviewPort } from './ports.ts';

export interface PlanResolution {
  /** Whether the plan id exists in the tenant's DS07 summary. */
  known: boolean;
  /** All reviewable plan ids — offered to the user when the id is unknown. */
  available: string[];
}

/**
 * Validate a plan id against the tenant's reviewable plans (the clarification
 * path from the agent-design failure policy: ambiguous / out-of-scope input is
 * surfaced, never guessed). An unknown plan would otherwise yield a degenerate
 * "everything missing" report — worse than saying "I don't know that plan".
 */
export async function resolveKnownPlan(
  port: PmoReviewPort,
  tenantId: string,
  planId: string,
): Promise<PlanResolution> {
  const plans = await port.listPlans({ tenantId });
  const available = plans.map((p) => p.planId);
  return { known: available.includes(planId), available };
}

/**
 * Throw a clear, user-facing message when the plan id is unknown. Used by the
 * read delegation tools (the LLM relays the message and offers valid ids); a
 * single throw does not trip the per-tool circuit breaker.
 */
export async function assertKnownPlan(
  port: PmoReviewPort,
  tenantId: string,
  planId: string,
): Promise<void> {
  const { known, available } = await resolveKnownPlan(port, tenantId, planId);
  if (!known) {
    throw new Error(
      `Plan "${planId}" not found. Available plans: ${available.join(', ') || '(none)'}.`,
    );
  }
}
