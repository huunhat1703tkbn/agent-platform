/**
 * Benchmark & velocity comparison against historical projects (DS05).
 * Contract: docs/projectplanguard/05-feasibility-rules-and-ds07.md §4.
 *
 * Deterministic cohort selection by `project_type`, excluding `is_outlier` rows and
 * implausibly tiny projects (e.g. PRJ-H-199, 15 MD / 0.5 mo → F-06), then comparing the
 * plan's velocity to the cohort average. Vector similarity over an embeddings store is a
 * later enhancement; the gradeable cohort/velocity math lives here as pure functions.
 */
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { cohortOnTimeFromSchedule, computePlanVelocity } from './plan-metrics.ts';
import { classifyOnTime, type RagStatus } from './rag.ts';

export interface HistoryRow {
  historical_project_id: string;
  project_type: string | null;
  duration_days: number | null;
  total_effort_days: number | null;
  is_outlier: boolean;
}

const DEFAULT_MIN_COHORT = 2;
// A project shorter than ~1 month or under ~1 person-month of effort is too small to benchmark.
const MIN_DURATION_DAYS = 30;
const MIN_EFFORT_DAYS = 30;

/** Velocity in man-days per month: effort_days / (duration_days / 30). */
export function historicalVelocityMdMonth(row: HistoryRow): number | null {
  if (!row.duration_days || !row.total_effort_days) return null;
  return row.total_effort_days / (row.duration_days / 30);
}

function isTooSmall(row: HistoryRow): boolean {
  return (
    (row.duration_days ?? 0) < MIN_DURATION_DAYS || (row.total_effort_days ?? 0) < MIN_EFFORT_DAYS
  );
}

export interface CohortResult {
  cohort_project_type: string;
  similar_projects: string[];
  outliers_excluded: string[];
  cohort_avg_velocity_md_month: number | null;
  insufficient_data: boolean;
}

export function selectCohort(
  history: HistoryRow[],
  projectType: string,
  minCohort: number = DEFAULT_MIN_COHORT,
): CohortResult {
  const matching = history.filter((r) => r.project_type === projectType);
  const similar: HistoryRow[] = [];
  const outliers_excluded: string[] = [];
  for (const r of matching) {
    if (r.is_outlier || isTooSmall(r)) outliers_excluded.push(r.historical_project_id);
    else similar.push(r);
  }

  const velocities = similar.map(historicalVelocityMdMonth).filter((v): v is number => v != null);
  const cohort_avg_velocity_md_month =
    velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : null;

  return {
    cohort_project_type: projectType,
    similar_projects: similar.map((r) => r.historical_project_id),
    outliers_excluded,
    cohort_avg_velocity_md_month,
    insufficient_data: similar.length < minCohort,
  };
}

export interface VelocityComparison {
  plan_velocity_md_month: number;
  cohort_avg_velocity_md_month: number | null;
  deviation_pct: number | null;
  rag: RagStatus | null;
}

/** Compare a plan's velocity to its cohort. Large over-estimates read as optimistic. */
export function compareVelocity(
  planVelocity: number,
  cohortAvg: number | null,
): VelocityComparison {
  if (cohortAvg == null || cohortAvg === 0) {
    return {
      plan_velocity_md_month: planVelocity,
      cohort_avg_velocity_md_month: cohortAvg,
      deviation_pct: null,
      rag: null,
    };
  }
  const deviation_pct = ((planVelocity - cohortAvg) / cohortAvg) * 100;
  const mag = Math.abs(deviation_pct);
  const rag: RagStatus = mag <= 15 ? 'Green' : mag <= 30 ? 'Yellow' : 'Red';
  return {
    plan_velocity_md_month: planVelocity,
    cohort_avg_velocity_md_month: cohortAvg,
    deviation_pct,
    rag,
  };
}

export interface BenchmarkAssessment extends CohortResult {
  plan_id: string;
  velocity: VelocityComparison;
  on_time_history_pct: number | null;
  on_time_rag: RagStatus | null;
}

/** Fetch the plan's cohort + velocity/on-time signals for the DS07 benchmark block. */
export async function assessBenchmark(input: {
  tenantId: string;
  planId: string;
}): Promise<BenchmarkAssessment> {
  const db = pmoDb();
  const [summary] = await db
    .select()
    .from(t.ds07Summary)
    .where(
      and(eq(t.ds07Summary.tenant_id, input.tenantId), eq(t.ds07Summary.plan_id, input.planId)),
    )
    .limit(1);

  const projectId = summary?.project_id ?? null;
  const [project] = projectId
    ? await db
        .select()
        .from(t.refProject)
        .where(
          and(eq(t.refProject.tenant_id, input.tenantId), eq(t.refProject.project_id, projectId)),
        )
        .limit(1)
    : [];
  const projectType = project?.project_type ?? '';

  const history = await db
    .select()
    .from(t.ds05History)
    .where(eq(t.ds05History.tenant_id, input.tenantId));

  const cohort = selectCohort(
    history.map((r) => ({
      historical_project_id: r.historical_project_id,
      project_type: r.project_type,
      duration_days: r.duration_days,
      total_effort_days: r.total_effort_days,
      is_outlier: r.is_outlier,
    })),
    projectType,
  );

  // Plan velocity is derived (Σ DS01 effort ÷ planned duration), not read from the
  // DS07 header — same value, but computed from the raw sheets.
  const planVelocity = await computePlanVelocity(input);
  const velocity = compareVelocity(
    planVelocity.velocity_md_month ?? 0,
    cohort.cohort_avg_velocity_md_month,
  );
  // On-time history is derived from the cohort's schedule adherence (mean of
  // min(1, planned/actual duration) over the same similar projects), NOT read from
  // the DS07 header. Same cohort as the velocity comparison (outliers/tiny excluded).
  const cohortRows = history.filter((r) =>
    cohort.similar_projects.includes(r.historical_project_id),
  );
  const onTime = cohortOnTimeFromSchedule(cohortRows);

  return {
    plan_id: input.planId,
    ...cohort,
    velocity,
    on_time_history_pct: onTime,
    on_time_rag: onTime == null ? null : classifyOnTime(onTime),
  };
}
