/**
 * Resource busy-rate (N01) and THI (N10) feasibility assessments.
 * Contract: docs/projectplanguard/05-feasibility-rules-and-ds07.md §3a, §3d.
 *
 * Two complementary busy-rate signals:
 *  - per-member, computed directly from DS03.busy_rate (already summed across projects);
 *  - the role-level peak (`peak_role_busy_rate_pct`), a header metric on the DS07 summary.
 * THI is computed from DS01 (Testing-phase effort ÷ total effort) — NOT read from the
 * DS07 header, which is a reference with error. All signals are classified against KPI norms.
 */
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { classifyBusyRate, classifyThi, type RagStatus, ragWorst } from './rag.ts';

export interface MemberBusyRate {
  member_id: string;
  role: string | null;
  busy_rate_pct: number;
  rag: RagStatus;
}

export interface BusyRateAssessment {
  plan_id: string;
  project_id: string | null;
  peak_role_busy_rate_pct: number | null;
  peak_rag: RagStatus | null;
  members: MemberBusyRate[];
  max_member_rag: RagStatus | null;
}

export interface ThiAssessment {
  plan_id: string;
  thi_pct: number | null;
  rag: RagStatus | null;
}

type Db = ReturnType<typeof pmoDb>;

async function getSummary(db: Db, tenantId: string, planId: string) {
  const [row] = await db
    .select()
    .from(t.ds07Summary)
    .where(and(eq(t.ds07Summary.tenant_id, tenantId), eq(t.ds07Summary.plan_id, planId)))
    .limit(1);
  return row ?? null;
}

export async function assessBusyRate(input: {
  tenantId: string;
  planId: string;
}): Promise<BusyRateAssessment> {
  const db = pmoDb();
  const summary = await getSummary(db, input.tenantId, input.planId);
  const projectId = summary?.project_id ?? null;

  const alloc = projectId
    ? await db
        .select()
        .from(t.ds03Alloc)
        .where(
          and(eq(t.ds03Alloc.tenant_id, input.tenantId), eq(t.ds03Alloc.project_id, projectId)),
        )
    : [];

  // DS03.busy_rate is stored as a fraction (1.25 = 125%); the KPI bands are in percent.
  const members: MemberBusyRate[] = alloc.map((a) => {
    const pct = (a.busy_rate ?? 0) * 100;
    return { member_id: a.member_id, role: a.role, busy_rate_pct: pct, rag: classifyBusyRate(pct) };
  });

  const peak = summary?.peak_role_busy_rate_pct ?? null;
  return {
    plan_id: input.planId,
    project_id: projectId,
    peak_role_busy_rate_pct: peak,
    peak_rag: peak == null ? null : classifyBusyRate(peak),
    members,
    max_member_rag: ragWorst(members.map((m) => m.rag)),
  };
}

const TESTING_PHASE = 'Testing';

/**
 * THI (N10): share of plan effort spent on Testing-phase (non-dev / QA) work —
 * Σ Testing effort ÷ Σ total effort, as a percentage rounded to one decimal place.
 * End-to-end acceptance testing is non-dev, so it counts. Pure; null when the plan
 * has no effort to divide by.
 */
export function thiFromTasks(
  tasks: { phase: string | null; effort_days: number | null }[],
): number | null {
  const total = tasks.reduce((acc, task) => acc + (task.effort_days ?? 0), 0);
  if (total <= 0) return null;
  const testing = tasks
    .filter((task) => task.phase === TESTING_PHASE)
    .reduce((acc, task) => acc + (task.effort_days ?? 0), 0);
  return Math.round((testing / total) * 1000) / 10;
}

export async function assessThi(input: {
  tenantId: string;
  planId: string;
}): Promise<ThiAssessment> {
  const db = pmoDb();
  const summary = await getSummary(db, input.tenantId, input.planId);
  const projectId = summary?.project_id ?? null;

  const tasks = projectId
    ? await db
        .select({ phase: t.ds01Tasks.phase, effort_days: t.ds01Tasks.effort_days })
        .from(t.ds01Tasks)
        .where(
          and(eq(t.ds01Tasks.tenant_id, input.tenantId), eq(t.ds01Tasks.project_id, projectId)),
        )
    : [];

  const thi = thiFromTasks(tasks);
  return {
    plan_id: input.planId,
    thi_pct: thi,
    rag: thi == null ? null : classifyThi(thi),
  };
}
