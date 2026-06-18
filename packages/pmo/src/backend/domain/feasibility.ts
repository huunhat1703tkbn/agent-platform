/**
 * Resource busy-rate (N01) and THI (N10) feasibility assessments.
 * Contract: docs/projectplanguard/05-feasibility-rules-and-ds07.md §3a, §3d.
 *
 * Two complementary busy-rate signals:
 *  - per-member, computed directly from DS03.busy_rate (already summed across projects);
 *  - the role-level peak (`peak_role_busy_rate_pct`), a header metric on the DS07 summary.
 * THI is the DS07 summary's Non-dev_h/Total_h metric; both are classified against KPI norms.
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

export async function assessThi(input: {
  tenantId: string;
  planId: string;
}): Promise<ThiAssessment> {
  const summary = await getSummary(pmoDb(), input.tenantId, input.planId);
  const thi = summary?.thi_pct ?? null;
  return {
    plan_id: input.planId,
    thi_pct: thi,
    rag: thi == null ? null : classifyThi(thi),
  };
}
