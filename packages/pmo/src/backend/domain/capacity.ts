/**
 * Role capacity-gap analysis — an AUDITABLE feasibility signal derived from the raw
 * sheets: per role, the plan's peak-month effort demand (DS01, mapped to a role via
 * DS03/REF) against that role's org capacity and spare headroom (DS08).
 *
 * IMPORTANT — this does NOT reproduce the DS07 `peak_role_busy_rate_pct` header.
 * That header is not reliably derivable from the normalised sheets (verified: the
 * combined current-load + plan-increment model lands near PLAN-002's 135% but ~24pp
 * off PLAN-001's 95%). So this is surfaced as its own explainable signal — "ML
 * Engineer needs 42 MD in its peak month vs 13 MD spare" — rather than overwriting
 * the ground-truth header. The verdict still reads `peak_role_busy_rate_pct` from DS07.
 * Contract background: docs/projectplanguard/05-feasibility-rules-and-ds07.md §3a.
 */
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { classifyBusyRate, type RagStatus } from './rag.ts';

/** DS03 uses role abbreviations; DS08 capacity uses full role titles. */
export const ROLE_ALIASES: Record<string, string> = {
  BE: 'Backend Developer',
  DE: 'Data Engineer',
  ML: 'ML Engineer',
  FE: 'Frontend Developer',
  QA: 'QA Engineer',
  BA: 'Business Analyst',
  PM: 'Project Manager',
  Sec: 'Security Engineer',
  Design: 'UX/UI Designer',
  DevOps: 'DevOps',
};

/** Map a DS03 role token to its DS08 canonical title (identity when unknown). */
export function canonicalRole(role: string | null): string | null {
  if (role == null) return null;
  return ROLE_ALIASES[role] ?? role;
}

export interface TaskEffort {
  effort_days: number | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Spread a task's effort across the calendar months it spans, proportional to the
 * number of days in each month. Pure; keys are `YYYY-MM`.
 */
export function spreadEffortByMonth(task: TaskEffort): Map<string, number> {
  const out = new Map<string, number>();
  const effort = task.effort_days ?? 0;
  if (effort <= 0 || !task.start_date || !task.end_date) return out;
  const start = new Date(task.start_date);
  const end = new Date(task.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;

  // Count inclusive days per month, then distribute effort proportionally.
  const days = new Map<string, number>();
  let total = 0;
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
    days.set(key, (days.get(key) ?? 0) + 1);
    total++;
  }
  for (const [month, d] of days) out.set(month, (effort * d) / total);
  return out;
}

export interface RoleCapacityGap {
  role: string;
  peak_month: string | null;
  peak_demand_md: number;
  capacity_md_month: number | null;
  available_md_month: number | null;
  current_busy_rate_pct: number | null;
  /** current load + this plan's peak-month increment, classified via N01. */
  projected_busy_rate_pct: number | null;
  /** plan peak-month demand as a % of the role's spare headroom (>100 = exceeds). */
  demand_vs_spare_pct: number | null;
  rag: RagStatus | null;
  exceeds_spare: boolean;
}

export interface CapacityGapAssessment {
  plan_id: string;
  project_id: string | null;
  roles: RoleCapacityGap[];
  /** Worst role by projected busy rate (the binding constraint), or null. */
  bottleneck: RoleCapacityGap | null;
  /** Roles present in the plan that have no DS08 capacity row (data-quality flag). */
  unmapped_roles: string[];
}

interface CapacityRow {
  role: string | null;
  capacity_md_month: number | null;
  available_md_month: number | null;
  busy_rate_pct: number | null;
}

/**
 * Pure core: given the plan's tasks, a member→role resolver, and DS08 capacity by
 * role, compute the peak-month demand and projected busy rate for each role.
 */
export function assessRoleCapacity(
  tasks: (TaskEffort & { assignee_id: string | null })[],
  roleByMember: Map<string, string | null>,
  capacityByRole: Map<string, CapacityRow>,
): { roles: RoleCapacityGap[]; unmapped_roles: string[] } {
  // role → month → demand (MD)
  const demand = new Map<string, Map<string, number>>();
  for (const task of tasks) {
    const role = canonicalRole(
      task.assignee_id ? (roleByMember.get(task.assignee_id) ?? null) : null,
    );
    if (!role) continue;
    const byMonth = demand.get(role) ?? new Map<string, number>();
    for (const [month, md] of spreadEffortByMonth(task)) {
      byMonth.set(month, (byMonth.get(month) ?? 0) + md);
    }
    demand.set(role, byMonth);
  }

  const roles: RoleCapacityGap[] = [];
  const unmapped_roles: string[] = [];
  for (const [role, byMonth] of demand) {
    let peak_month: string | null = null;
    let peak_demand_md = 0;
    for (const [month, md] of byMonth) {
      if (md > peak_demand_md) {
        peak_demand_md = md;
        peak_month = month;
      }
    }
    const cap = capacityByRole.get(role);
    if (!cap || cap.capacity_md_month == null) {
      unmapped_roles.push(role);
      roles.push({
        role,
        peak_month,
        peak_demand_md,
        capacity_md_month: null,
        available_md_month: null,
        current_busy_rate_pct: null,
        projected_busy_rate_pct: null,
        demand_vs_spare_pct: null,
        rag: null,
        exceeds_spare: false,
      });
      continue;
    }
    const incrementPct = (peak_demand_md / cap.capacity_md_month) * 100;
    const projected = (cap.busy_rate_pct ?? 0) + incrementPct;
    const spare = cap.available_md_month ?? 0;
    const demand_vs_spare_pct = spare > 0 ? (peak_demand_md / spare) * 100 : null;
    roles.push({
      role,
      peak_month,
      peak_demand_md,
      capacity_md_month: cap.capacity_md_month,
      available_md_month: cap.available_md_month,
      current_busy_rate_pct: cap.busy_rate_pct,
      projected_busy_rate_pct: projected,
      demand_vs_spare_pct,
      rag: classifyBusyRate(projected),
      exceeds_spare: spare >= 0 && peak_demand_md > spare,
    });
  }

  roles.sort((a, b) => (b.projected_busy_rate_pct ?? 0) - (a.projected_busy_rate_pct ?? 0));
  return { roles, unmapped_roles };
}

/**
 * Fetch DS01 (effort/dates/assignee) + DS03 (member→role) + DS08 (role capacity) and
 * compute the plan's role capacity-gap analysis.
 */
export async function computeRoleCapacityGap(input: {
  tenantId: string;
  planId: string;
}): Promise<CapacityGapAssessment> {
  const db = pmoDb();
  const [summary] = await db
    .select({ project_id: t.ds07Summary.project_id })
    .from(t.ds07Summary)
    .where(
      and(eq(t.ds07Summary.tenant_id, input.tenantId), eq(t.ds07Summary.plan_id, input.planId)),
    )
    .limit(1);
  const projectId = summary?.project_id ?? null;

  if (!projectId) {
    return {
      plan_id: input.planId,
      project_id: null,
      roles: [],
      bottleneck: null,
      unmapped_roles: [],
    };
  }

  const [tasks, alloc, capacity] = await Promise.all([
    db
      .select({
        assignee_id: t.ds01Tasks.assignee_id,
        effort_days: t.ds01Tasks.effort_days,
        start_date: t.ds01Tasks.start_date,
        end_date: t.ds01Tasks.end_date,
      })
      .from(t.ds01Tasks)
      .where(and(eq(t.ds01Tasks.tenant_id, input.tenantId), eq(t.ds01Tasks.project_id, projectId))),
    db
      .select({ member_id: t.ds03Alloc.member_id, role: t.ds03Alloc.role })
      .from(t.ds03Alloc)
      .where(and(eq(t.ds03Alloc.tenant_id, input.tenantId), eq(t.ds03Alloc.project_id, projectId))),
    db
      .select({
        role: t.ds08Capacity.role,
        capacity_md_month: t.ds08Capacity.capacity_md_month,
        available_md_month: t.ds08Capacity.available_md_month,
        busy_rate_pct: t.ds08Capacity.busy_rate_pct,
      })
      .from(t.ds08Capacity)
      .where(eq(t.ds08Capacity.tenant_id, input.tenantId)),
  ]);

  const roleByMember = new Map(alloc.map((a) => [a.member_id, a.role]));
  const capacityByRole = new Map(
    capacity
      .filter((c): c is CapacityRow & { role: string } => c.role != null)
      .map((c) => [c.role, c]),
  );

  const { roles, unmapped_roles } = assessRoleCapacity(tasks, roleByMember, capacityByRole);
  return {
    plan_id: input.planId,
    project_id: projectId,
    roles,
    bottleneck: roles[0] ?? null,
    unmapped_roles,
  };
}
