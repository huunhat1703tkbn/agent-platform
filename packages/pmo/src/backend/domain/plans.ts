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

/** A descriptive overview of a plan (no feasibility verdict) — header metrics
 *  plus project type and the task scope (count + phases). Powers "describe this
 *  project" style questions without running the review engine. */
export interface PlanOverview {
  plan_id: string;
  project_id: string | null;
  project_name: string | null;
  project_type: string | null;
  plan_set: string | null;
  effort_md: number | null;
  duration_months: number | null;
  velocity_md_month: number | null;
  team_size: number | null;
  risk_count: number | null;
  task_count: number;
  phases: string[];
}

export async function getPlanOverview(input: {
  tenantId: string;
  planId: string;
}): Promise<PlanOverview | null> {
  const db = pmoDb();
  const [summary] = await db
    .select()
    .from(t.ds07Summary)
    .where(
      and(eq(t.ds07Summary.tenant_id, input.tenantId), eq(t.ds07Summary.plan_id, input.planId)),
    )
    .limit(1);
  if (!summary) return null;

  const projectId = summary.project_id;
  const [project] = projectId
    ? await db
        .select({ project_type: t.refProject.project_type })
        .from(t.refProject)
        .where(
          and(eq(t.refProject.tenant_id, input.tenantId), eq(t.refProject.project_id, projectId)),
        )
        .limit(1)
    : [];
  const tasks = projectId
    ? await db
        .select({ phase: t.ds01Tasks.phase })
        .from(t.ds01Tasks)
        .where(
          and(eq(t.ds01Tasks.tenant_id, input.tenantId), eq(t.ds01Tasks.project_id, projectId)),
        )
    : [];
  const phases = [...new Set(tasks.map((r) => r.phase).filter((p): p is string => !!p))].sort();

  return {
    plan_id: summary.plan_id,
    project_id: summary.project_id,
    project_name: summary.project_name,
    project_type: project?.project_type ?? null,
    plan_set: summary.plan_set,
    effort_md: summary.effort_md,
    duration_months: summary.duration_months,
    velocity_md_month: summary.velocity_md_month,
    team_size: summary.team_size,
    risk_count: summary.risk_count,
    task_count: tasks.length,
    phases,
  };
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
