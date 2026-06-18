/** Plan listing for the review picker — the plans under review (DS07 summary rows). */
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';

export interface PlanListItem {
  plan_id: string;
  project_id: string | null;
  project_name: string | null;
  plan_set: string | null;
}

export async function listPlans(input: { tenantId: string }): Promise<PlanListItem[]> {
  const rows = await pmoDb()
    .select({
      plan_id: t.ds07Summary.plan_id,
      project_id: t.ds07Summary.project_id,
      project_name: t.ds07Summary.project_name,
      plan_set: t.ds07Summary.plan_set,
    })
    .from(t.ds07Summary)
    .where(eq(t.ds07Summary.tenant_id, input.tenantId))
    .orderBy(t.ds07Summary.plan_id);
  return rows;
}

/** Whether a plan already has an issued review report (most recent status). */
export async function getLatestReportStatus(input: {
  tenantId: string;
  planId: string;
}): Promise<string | null> {
  const [row] = await pmoDb()
    .select({ status: t.reviewReport.status, created_at: t.reviewReport.created_at })
    .from(t.reviewReport)
    .where(
      and(eq(t.reviewReport.tenant_id, input.tenantId), eq(t.reviewReport.plan_id, input.planId)),
    )
    .orderBy(t.reviewReport.created_at)
    .limit(1);
  return row?.status ?? null;
}
