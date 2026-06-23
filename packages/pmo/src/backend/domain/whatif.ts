/**
 * What-if headcount simulation — recompute the Resource feasibility signal under a
 * proposed staffing change, and the inverse (how many people to hire to hit a target).
 *
 * Built on the raw capacity gap (capacity.ts): a role's projected peak busy scales with
 * headcount as `projected × H / (H + delta)` (adding people dilutes the same demand over
 * more capacity). The simulation re-derives the bottleneck and Resource RAG; it does NOT
 * touch the other pillars — adding engineers does not fix a missing Risk Register or a
 * dependency cycle, which is exactly the cross-dimension honesty we want to surface.
 *
 * Contract background: docs/projectplanguard/05-feasibility-rules-and-ds07.md §3a.
 */
import { eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { classifyCapacityOverload, type RagStatus } from './rag.ts';
import {
  buildReviewReport,
  detectCrossDimensionConflict,
  type FeasibilityStatus,
  type Pillar,
  rollupFeasibilityStatus,
} from './synthesis.ts';

/** Default target busy ceiling — the top of the Green band (≤110% is Green per N01-overload). */
export const DEFAULT_TARGET_BUSY_PCT = 110;

/**
 * Projected busy after adding (`delta` > 0) or removing (`delta` < 0) people of a role.
 * Same plan demand spread over `H + delta` capacity. The effective denominator is floored
 * at 1 — a role cannot be staffed below one person.
 */
export function scaleProjectedBusy(projectedPct: number, headcount: number, delta: number): number {
  const effective = Math.max(1, headcount + delta);
  return (projectedPct * headcount) / effective;
}

/**
 * People to add to a role to bring its projected busy down to `targetPct`.
 * `delta = H × (projected / target − 1)`, rounded up; never negative.
 */
export function hiringToTarget(
  projectedPct: number,
  headcount: number,
  targetPct: number = DEFAULT_TARGET_BUSY_PCT,
): number {
  if (projectedPct <= targetPct) return 0;
  return Math.ceil(headcount * (projectedPct / targetPct - 1));
}

export interface RoleProjection {
  role: string;
  projected_busy_rate_pct: number;
}

export interface RoleChangeSimulation {
  role: string;
  delta: number;
  role_found: boolean;
  available_roles: string[];
  bottleneck_before: RoleProjection | null;
  bottleneck_after: RoleProjection | null;
  resource_rag_before: RagStatus | null;
  resource_rag_after: RagStatus | null;
}

function bottleneckOf(roles: RoleProjection[]): RoleProjection | null {
  return roles.reduce<RoleProjection | null>(
    (worst, r) =>
      worst == null || r.projected_busy_rate_pct > worst.projected_busy_rate_pct ? r : worst,
    null,
  );
}

/**
 * Pure simulation: apply a headcount `delta` to `role`, rescale its projected busy, and
 * re-derive the bottleneck + Resource RAG. Other roles are held. Flags an unknown role.
 */
export function simulateRoleChange(
  roles: RoleProjection[],
  headcountByRole: Map<string, number>,
  role: string,
  delta: number,
): RoleChangeSimulation {
  const available_roles = roles.map((r) => r.role);
  const before = bottleneckOf(roles);
  const resource_rag_before = before
    ? classifyCapacityOverload(before.projected_busy_rate_pct)
    : null;

  if (!available_roles.includes(role)) {
    return {
      role,
      delta,
      role_found: false,
      available_roles,
      bottleneck_before: before,
      bottleneck_after: before,
      resource_rag_before,
      resource_rag_after: resource_rag_before,
    };
  }

  const headcount = headcountByRole.get(role) ?? 1;
  const after = roles.map((r) =>
    r.role === role
      ? {
          role: r.role,
          projected_busy_rate_pct: scaleProjectedBusy(r.projected_busy_rate_pct, headcount, delta),
        }
      : r,
  );
  const bottleneck_after = bottleneckOf(after);

  return {
    role,
    delta,
    role_found: true,
    available_roles,
    bottleneck_before: before,
    bottleneck_after,
    resource_rag_before,
    resource_rag_after: bottleneck_after
      ? classifyCapacityOverload(bottleneck_after.projected_busy_rate_pct)
      : null,
  };
}

/** Re-roll the verdict after swapping in a new Resource RAG; other pillars held. */
function rerollVerdict(
  pillars: Pillar[],
  complianceScorePct: number,
  newResourceRag: RagStatus | null,
): FeasibilityStatus {
  const updated = pillars.map((p) =>
    p.dimension === 'Resource' && newResourceRag ? { ...p, rag: newResourceRag } : p,
  );
  const conflict = detectCrossDimensionConflict(complianceScorePct, updated);
  return rollupFeasibilityStatus(updated, conflict.conflict);
}

async function headcountByRole(tenantId: string): Promise<Map<string, number>> {
  const caps = await pmoDb()
    .select({ role: t.ds08Capacity.role, headcount: t.ds08Capacity.headcount })
    .from(t.ds08Capacity)
    .where(eq(t.ds08Capacity.tenant_id, tenantId));
  return new Map(
    caps
      .filter((c): c is { role: string; headcount: number | null } => c.role != null)
      .map((c) => [c.role, c.headcount ?? 1]),
  );
}

export interface HeadcountSimulation extends RoleChangeSimulation {
  plan_id: string;
  feasibility_before: FeasibilityStatus;
  feasibility_after: FeasibilityStatus;
  changed: boolean;
  note: string;
}

/**
 * Simulate adding/removing `delta` people of `role` on a plan: rescale the role's
 * projected busy, re-derive the Resource RAG and re-roll the verdict (other pillars held).
 * Null for an unknown plan; flags an unknown role (with the available roles to clarify).
 */
export async function simulateHeadcount(input: {
  tenantId: string;
  planId: string;
  role: string;
  delta: number;
}): Promise<HeadcountSimulation | null> {
  const base = await buildReviewReport({ tenantId: input.tenantId, planId: input.planId });
  if (!base.project_id) return null; // unknown plan / no project

  const roles: RoleProjection[] = base.capacity.roles
    .filter((r) => r.projected_busy_rate_pct != null)
    .map((r) => ({ role: r.role, projected_busy_rate_pct: r.projected_busy_rate_pct as number }));

  const headcounts = await headcountByRole(input.tenantId);
  const sim = simulateRoleChange(roles, headcounts, input.role, input.delta);

  const feasibility_before = base.feasibility_status;
  const feasibility_after = sim.role_found
    ? rerollVerdict(base.pillars, base.compliance_score_pct, sim.resource_rag_after)
    : feasibility_before;

  const note = !sim.role_found
    ? `Role "${input.role}" is not staffed on this plan. Pick one of: ${sim.available_roles.join(', ')}.`
    : feasibility_after === feasibility_before
      ? 'Estimate (peak-scaling). Resource changes, but the verdict is unchanged — other dimensions still bind.'
      : 'Estimate (peak-scaling). The headcount change moves the verdict.';

  return {
    ...sim,
    plan_id: input.planId,
    feasibility_before,
    feasibility_after,
    changed: feasibility_after !== feasibility_before,
    note,
  };
}

export interface HiringRecommendation {
  plan_id: string;
  bottleneck: RoleProjection | null;
  headcount: number | null;
  hires_to_target: number;
  target_pct: number;
  feasibility_before: FeasibilityStatus;
  feasibility_after_hiring: FeasibilityStatus;
  resolves_feasibility: boolean;
  /** Non-Resource pillars that remain Red — hiring cannot fix these. */
  remaining_blockers: string[];
  note: string;
}

/**
 * Inverse what-if: how many people to add to the bottleneck role to bring it to target,
 * and — honestly — whether that alone makes the plan feasible (it usually does not, because
 * Risk/dependency/THI pillars are independent of headcount).
 */
export async function recommendHiring(input: {
  tenantId: string;
  planId: string;
  targetPct?: number;
}): Promise<HiringRecommendation | null> {
  const target = input.targetPct ?? DEFAULT_TARGET_BUSY_PCT;
  const base = await buildReviewReport({ tenantId: input.tenantId, planId: input.planId });
  if (!base.project_id) return null;

  const bn = base.capacity.bottleneck;
  const bottleneck: RoleProjection | null =
    bn && bn.projected_busy_rate_pct != null
      ? { role: bn.role, projected_busy_rate_pct: bn.projected_busy_rate_pct }
      : null;

  const headcounts = await headcountByRole(input.tenantId);
  const headcount = bottleneck ? (headcounts.get(bottleneck.role) ?? 1) : null;
  const hires =
    bottleneck && headcount != null
      ? hiringToTarget(bottleneck.projected_busy_rate_pct, headcount, target)
      : 0;

  const feasibility_before = base.feasibility_status;
  const sim =
    bottleneck && hires > 0
      ? await simulateHeadcount({
          tenantId: input.tenantId,
          planId: input.planId,
          role: bottleneck.role,
          delta: hires,
        })
      : null;
  const feasibility_after_hiring = sim?.feasibility_after ?? feasibility_before;

  const remaining_blockers = base.pillars
    .filter((p) => p.dimension !== 'Resource' && p.rag === 'Red')
    .map((p) => p.dimension);

  const resolves_feasibility = feasibility_after_hiring === 'Feasible (Green)';
  const note = !bottleneck
    ? 'No role capacity mapped — cannot recommend hiring.'
    : hires === 0
      ? `${bottleneck.role} is already within the ${target}% target; no hiring needed for capacity.`
      : resolves_feasibility
        ? `Hiring +${hires} ${bottleneck.role} brings peak busy to ≤${target}% and makes the plan feasible.`
        : `Hiring +${hires} ${bottleneck.role} clears the capacity gap, but the plan stays infeasible — unresolved: ${remaining_blockers.join(', ')}.`;

  return {
    plan_id: input.planId,
    bottleneck,
    headcount,
    hires_to_target: hires,
    target_pct: target,
    feasibility_before,
    feasibility_after_hiring,
    resolves_feasibility,
    remaining_blockers,
    note,
  };
}
