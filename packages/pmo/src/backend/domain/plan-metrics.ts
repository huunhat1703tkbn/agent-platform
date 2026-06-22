/**
 * Plan-level metrics derived from the raw normalised sheets, replacing reads of
 * the DS07 header where the value is genuinely derivable.
 * Contract: docs/projectplanguard/05-feasibility-rules-and-ds07.md §3c, §4.
 *
 * - Velocity: `effort_md` = Σ DS01.effort_days (computed, exact vs DS07);
 *   `duration_months` is DERIVED FROM THE DS01 SCHEDULE — the span between the
 *   earliest task start and the latest task end, max(end) − min(start), expressed
 *   in 30-day months (span_days ÷ 30). It is NOT read from the DS07 header claim.
 *   `velocity_md_month` = effort_md / duration_months. The gap between this
 *   schedule-derived duration and the PM's DS07 claim is itself the optimism signal
 *   (surfaced via `computeScheduleRealism`).
 *
 * - On-time history: cohort SCHEDULE ADHERENCE — the mean of min(1, planned/actual
 *   duration) over the same-type, non-outlier historical projects (DS05). Same
 *   meaning as on-time delivery (schedule kept), derived from actual vs planned
 *   duration — NOT scope (avg_velocity_ratio) nor the coarse final_outcome label.
 *   Replaces the DS07 `on_time_history_pct` header read (~4pp high vs the header).
 */
import { and, eq } from 'drizzle-orm';
import { pmoDb } from '../db/client.ts';
import * as t from '../db/schema.ts';
import { classifyOnTime, type RagStatus } from './rag.ts';

export interface PlanVelocity {
  plan_id: string;
  project_id: string | null;
  effort_md: number; // Σ DS01.effort_days
  duration_months: number | null; // derived from the DS01 task schedule; null when no dates
  velocity_md_month: number | null;
}

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;

/**
 * Schedule span in months from a set of task dates: the difference between the
 * latest end and the earliest start, max(end) − min(start), expressed in 30-day
 * months (span_days ÷ 30). Derived from the plan itself — NOT read from the DS07
 * `duration_months` claim. Powers both the velocity denominator and the
 * schedule-realism comparison. Null when there are no usable dates.
 */
export function monthsSpan(dates: (string | null)[]): number | null {
  const ts = dates
    .filter((d): d is string => !!d)
    .map((d) => new Date(d).getTime())
    .filter((n) => !Number.isNaN(n));
  if (ts.length === 0) return null;
  return (Math.max(...ts) - Math.min(...ts)) / MS_PER_DAY / DAYS_PER_MONTH;
}

/** Σ of the plan's task effort (DS01.effort_days). */
export function sumEffortMd(tasks: { effort_days: number | null }[]): number {
  return tasks.reduce((acc, task) => acc + (task.effort_days ?? 0), 0);
}

/**
 * Velocity in man-days per month: computed effort ÷ the schedule-derived duration
 * (max(end) − min(start) ÷ 30). Null when the duration is missing or non-positive.
 */
export function planVelocityMdMonth(
  effortMd: number,
  durationMonths: number | null,
): number | null {
  if (durationMonths == null || durationMonths <= 0) return null;
  return effortMd / durationMonths;
}

/**
 * Compute a plan's effort, duration and velocity entirely from DS01 — Σ effort_days
 * for the effort and the inclusive task-date span (÷ 28) for the duration — instead
 * of reading the DS07 `effort_md`/`duration_months`/`velocity_md_month` header claims.
 */
export async function computePlanVelocity(input: {
  tenantId: string;
  planId: string;
}): Promise<PlanVelocity> {
  const db = pmoDb();
  const [summary] = await db
    .select({ project_id: t.ds07Summary.project_id })
    .from(t.ds07Summary)
    .where(
      and(eq(t.ds07Summary.tenant_id, input.tenantId), eq(t.ds07Summary.plan_id, input.planId)),
    )
    .limit(1);

  const projectId = summary?.project_id ?? null;

  const tasks = projectId
    ? await db
        .select({
          effort_days: t.ds01Tasks.effort_days,
          start_date: t.ds01Tasks.start_date,
          end_date: t.ds01Tasks.end_date,
        })
        .from(t.ds01Tasks)
        .where(
          and(eq(t.ds01Tasks.tenant_id, input.tenantId), eq(t.ds01Tasks.project_id, projectId)),
        )
    : [];

  const effort_md = sumEffortMd(tasks);
  const duration_months = monthsSpan(tasks.flatMap((r) => [r.start_date, r.end_date]));
  return {
    plan_id: input.planId,
    project_id: projectId,
    effort_md,
    duration_months,
    velocity_md_month: planVelocityMdMonth(effort_md, duration_months),
  };
}

export interface ScheduleRealism {
  plan_id: string;
  /** Derived from DS01 task dates: (max end − min start) in months. */
  schedule_span_months: number | null;
  /** The PM's PLANNED duration (DS07 header) — the claim under review. */
  planned_duration_months: number | null;
  /** (span − planned) / planned × 100; positive ⇒ tasks scheduled past the claim. */
  over_run_pct: number | null;
  /** True when the task schedule cannot fit inside the planned duration. */
  span_exceeds_planned: boolean;
}

/**
 * Compare the plan's actual task-schedule span against its PLANNED duration.
 * When the tasks are scheduled across more calendar time than the plan claims
 * (e.g. PLAN-104: tasks span ~7.3 mo but the plan states 5 mo), the timeline is
 * internally inconsistent / optimistic. Pure.
 */
export function scheduleRealism(
  spanMonths: number | null,
  plannedMonths: number | null,
): { over_run_pct: number | null; span_exceeds_planned: boolean } {
  if (spanMonths == null || plannedMonths == null || plannedMonths <= 0) {
    return { over_run_pct: null, span_exceeds_planned: false };
  }
  const over_run_pct = ((spanMonths - plannedMonths) / plannedMonths) * 100;
  return { over_run_pct, span_exceeds_planned: spanMonths > plannedMonths };
}

/**
 * Derive the plan's schedule span from DS01 task dates and flag when it exceeds
 * the planned (DS07) duration — a timeline-realism signal that complements the
 * velocity-vs-benchmark comparison. Surfaced as its own signal; it does not
 * change `velocity_md_month` (still computed on the planned duration).
 */
export async function computeScheduleRealism(input: {
  tenantId: string;
  planId: string;
}): Promise<ScheduleRealism> {
  const db = pmoDb();
  const [summary] = await db
    .select({
      project_id: t.ds07Summary.project_id,
      duration_months: t.ds07Summary.duration_months,
    })
    .from(t.ds07Summary)
    .where(
      and(eq(t.ds07Summary.tenant_id, input.tenantId), eq(t.ds07Summary.plan_id, input.planId)),
    )
    .limit(1);

  const projectId = summary?.project_id ?? null;
  const plannedDuration = summary?.duration_months ?? null;

  const tasks = projectId
    ? await db
        .select({ start_date: t.ds01Tasks.start_date, end_date: t.ds01Tasks.end_date })
        .from(t.ds01Tasks)
        .where(
          and(eq(t.ds01Tasks.tenant_id, input.tenantId), eq(t.ds01Tasks.project_id, projectId)),
        )
    : [];

  const span = monthsSpan(tasks.flatMap((r) => [r.start_date, r.end_date]));
  const { over_run_pct, span_exceeds_planned } = scheduleRealism(span, plannedDuration);
  return {
    plan_id: input.planId,
    schedule_span_months: span,
    planned_duration_months: plannedDuration,
    over_run_pct,
    span_exceeds_planned,
  };
}

export interface OnTimeHistory {
  plan_id: string;
  cohort_project_type: string | null;
  cohort_size: number; // non-outlier projects of the same type
  on_time_history_pct: number | null; // null when the cohort is empty
  rag: RagStatus | null;
  insufficient_data: boolean;
}

const DEFAULT_MIN_COHORT = 2;

/**
 * Per-project schedule adherence: min(1, planned_duration_days / duration_days).
 * 1.0 = delivered on or ahead of the planned schedule; < 1.0 = late, proportional
 * to the overrun (e.g. 14% late → 0.875). Null when either duration is missing/zero.
 */
export function scheduleAdherence(
  durationDays: number | null,
  plannedDays: number | null,
): number | null {
  if (!durationDays || durationDays <= 0 || !plannedDays || plannedDays <= 0) return null;
  return Math.min(1, plannedDays / durationDays);
}

/**
 * Cohort on-time rate from schedule adherence: the mean of min(1, planned/actual)
 * across the cohort, as a percent (0–100). Same meaning as on-time delivery
 * (schedule kept), from DS05 actual vs planned duration. Null when empty.
 */
export function cohortOnTimeFromSchedule(
  rows: { duration_days: number | null; planned_duration_days: number | null }[],
): number | null {
  const vals = rows
    .map((r) => scheduleAdherence(r.duration_days, r.planned_duration_days))
    .filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
}

/**
 * Derive the cohort on-time delivery rate (N07 signal) from DS05: of the same-type,
 * non-outlier historical projects, the mean schedule adherence (min(1, planned/actual)),
 * classified Green/Yellow/Red. Degrades to `insufficient_data` when the cohort is
 * too small rather than guessing.
 */
export async function computeOnTimeHistory(
  input: { tenantId: string; planId: string },
  minCohort: number = DEFAULT_MIN_COHORT,
): Promise<OnTimeHistory> {
  const db = pmoDb();
  const [summary] = await db
    .select({ project_id: t.ds07Summary.project_id })
    .from(t.ds07Summary)
    .where(
      and(eq(t.ds07Summary.tenant_id, input.tenantId), eq(t.ds07Summary.plan_id, input.planId)),
    )
    .limit(1);

  const projectId = summary?.project_id ?? null;
  const [project] = projectId
    ? await db
        .select({ project_type: t.refProject.project_type })
        .from(t.refProject)
        .where(
          and(eq(t.refProject.tenant_id, input.tenantId), eq(t.refProject.project_id, projectId)),
        )
        .limit(1)
    : [];

  const projectType = project?.project_type ?? null;
  const history = projectType
    ? await db
        .select({
          duration_days: t.ds05History.duration_days,
          planned_duration_days: t.ds05History.planned_duration_days,
          is_outlier: t.ds05History.is_outlier,
        })
        .from(t.ds05History)
        .where(
          and(
            eq(t.ds05History.tenant_id, input.tenantId),
            eq(t.ds05History.project_type, projectType),
          ),
        )
    : [];

  const cohort = history.filter((r) => !r.is_outlier);
  const pct = cohortOnTimeFromSchedule(cohort);

  return {
    plan_id: input.planId,
    cohort_project_type: projectType,
    cohort_size: cohort.length,
    on_time_history_pct: pct,
    rag: pct == null ? null : classifyOnTime(pct),
    insufficient_data: cohort.length < minCohort,
  };
}
